// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ElementCards} from "./ElementCards.sol";
import {GameCoin} from "./GameCoin.sol";

/**
 * @title Arena
 * @notice Staked 3v3 relay battles using commit-reveal, so neither player can
 *         see the other's ordered team before choosing their own.
 *
 * Flow: creator commits + stakes coins -> opponent commits + matches the stake ->
 * both reveal within REVEAL_WINDOW -> the contract pays the winner in coins.
 * If only one player reveals in time, that player can claim the whole pot.
 *
 * The contract reads card data from ElementCards, an example of contracts
 * composing with each other. See docs/INTERFACE.md.
 */
contract Arena is ReentrancyGuard {
    enum Status {
        None,
        Open,
        Joined,
        Resolved,
        Cancelled
    }

    struct Battle {
        address creator;
        address opponent;
        uint256 stake;
        bytes32 creatorCommitment;
        bytes32 opponentCommitment;
        uint256[3] creatorTokenIds;
        uint256[3] opponentTokenIds;
        bool creatorRevealed;
        bool opponentRevealed;
        uint64 revealDeadline;
        Status status;
        // Set when the battle is resolved; address(0) means a draw (both refunded).
        address winner;
    }

    uint256 public constant REVEAL_WINDOW = 10 minutes;
    uint8 public constant MAX_ROUNDS = 20;
    uint8 public constant TEAM_SIZE = 3;

    struct TeamCombatResult {
        uint256[3] hpA;
        uint256[3] hpB;
        uint8 rounds;
        // 0 = draw, 1 = A, 2 = B.
        uint8 winner;
    }

    struct CombatResult {
        uint256 hpA;
        uint256 hpB;
        uint256 damageA;
        uint256 damageB;
        uint8 rounds;
        // 0 = draw, 1 = A, 2 = B.
        uint8 winner;
    }

    ElementCards public immutable cards;
    GameCoin public immutable coin;

    // Battle IDs start at 1; battleCount is also the latest battle ID.
    uint256 public battleCount;

    mapping(uint256 battleId => Battle) private _battles;

    // Card attributes copied at reveal time, so a player who burns or transfers
    // a revealed card cannot stop the battle from resolving.
    mapping(uint256 battleId => ElementCards.Card[3]) private _creatorCards;
    mapping(uint256 battleId => ElementCards.Card[3]) private _opponentCards;

    // Every battle a player created or joined, oldest first, for history pages.
    mapping(address player => uint256[]) private _playerBattles;

    event BattleCreated(uint256 indexed battleId, address indexed creator, uint256 stake);
    event BattleJoined(uint256 indexed battleId, address indexed opponent, uint64 revealDeadline);
    event TeamRevealed(uint256 indexed battleId, address indexed player, uint256[3] tokenIds);
    event BattleResolved(uint256 indexed battleId, address indexed winner, uint256 payout);
    event BattleCancelled(uint256 indexed battleId);

    error BattleNotFound(uint256 battleId);
    error InvalidStatus(Status current);
    error CannotJoinOwnBattle();
    error NotPlayer();
    error NotCreator();
    error AlreadyRevealed();
    error CommitmentMismatch();
    error NotCardOwner(uint256 tokenId);
    error DuplicateCard(uint256 tokenId);
    error InvalidCombatStats();
    error RevealWindowClosed();
    error RevealWindowOpen();

    constructor(address cardsAddress) {
        cards = ElementCards(cardsAddress);
        coin = cards.coin();
    }

    /**
     * @notice Open a battle, staking coins (0 is a friendly match).
     * @param commitment computeCommitment(tokenIds, salt, msg.sender), built in the browser.
     * @param stake Coins taken from the caller and held here until the battle ends.
     */
    function createBattle(bytes32 commitment, uint256 stake) external nonReentrant returns (uint256 battleId) {
        battleId = ++battleCount;
        Battle storage battle = _battles[battleId];
        battle.creator = msg.sender;
        battle.stake = stake;
        battle.creatorCommitment = commitment;
        battle.status = Status.Open;
        _playerBattles[msg.sender].push(battleId);
        emit BattleCreated(battleId, msg.sender, stake);
        coin.collect(msg.sender, address(this), stake);
    }

    /// @notice Join an open battle. The same stake is taken from the caller.
    function joinBattle(uint256 battleId, bytes32 commitment) external nonReentrant {
        Battle storage battle = _existingBattle(battleId);
        if (battle.status != Status.Open) revert InvalidStatus(battle.status);
        if (msg.sender == battle.creator) revert CannotJoinOwnBattle();

        uint64 deadline = uint64(block.timestamp + REVEAL_WINDOW);
        battle.opponent = msg.sender;
        battle.opponentCommitment = commitment;
        battle.revealDeadline = deadline;
        battle.status = Status.Joined;
        _playerBattles[msg.sender].push(battleId);
        emit BattleJoined(battleId, msg.sender, deadline);
        coin.collect(msg.sender, address(this), battle.stake);
    }

    /**
     * @notice Reveal the committed ordered team. The second reveal resolves the battle.
     * @param salt The random 32 bytes used when committing.
     */
    function reveal(uint256 battleId, uint256[3] calldata tokenIds, bytes32 salt) external nonReentrant {
        Battle storage battle = _existingBattle(battleId);
        if (battle.status != Status.Joined) revert InvalidStatus(battle.status);
        if (block.timestamp > battle.revealDeadline) revert RevealWindowClosed();

        bool isCreator = msg.sender == battle.creator;
        if (!isCreator && msg.sender != battle.opponent) revert NotPlayer();
        if (isCreator ? battle.creatorRevealed : battle.opponentRevealed) revert AlreadyRevealed();

        bytes32 commitment = isCreator ? battle.creatorCommitment : battle.opponentCommitment;
        if (computeCommitment(tokenIds, salt, msg.sender) != commitment) revert CommitmentMismatch();
        ElementCards.Card[3] memory team;
        for (uint256 i = 0; i < TEAM_SIZE; i++) {
            uint256 tokenId = tokenIds[i];
            for (uint256 j = 0; j < i; j++) {
                if (tokenIds[j] == tokenId) revert DuplicateCard(tokenId);
            }
            // ownerOf reverts if the card was burned. Validate every card before storing any.
            if (cards.ownerOf(tokenId) != msg.sender) revert NotCardOwner(tokenId);
            team[i] = cards.getCard(tokenId);
        }
        if (isCreator) {
            battle.creatorTokenIds = tokenIds;
            battle.creatorRevealed = true;
            for (uint256 i = 0; i < TEAM_SIZE; i++) _creatorCards[battleId][i] = team[i];
        } else {
            battle.opponentTokenIds = tokenIds;
            battle.opponentRevealed = true;
            for (uint256 i = 0; i < TEAM_SIZE; i++) _opponentCards[battleId][i] = team[i];
        }
        emit TeamRevealed(battleId, msg.sender, tokenIds);

        if (battle.creatorRevealed && battle.opponentRevealed) _resolve(battleId);
    }

    /**
     * @notice After the reveal window, settle a battle where a player did not reveal.
     *         Exactly one reveal: that player takes the pot. No reveals: both refunded.
     */
    function claimTimeout(uint256 battleId) external nonReentrant {
        Battle storage battle = _existingBattle(battleId);
        if (battle.status != Status.Joined) revert InvalidStatus(battle.status);
        if (block.timestamp <= battle.revealDeadline) revert RevealWindowOpen();

        // Both players cannot have revealed here: the second reveal resolves the battle.
        address winner;
        if (battle.creatorRevealed) winner = battle.creator;
        else if (battle.opponentRevealed) winner = battle.opponent;
        _settle(battleId, winner);
    }

    /// @notice The creator takes back the stake if nobody has joined yet.
    function cancelBattle(uint256 battleId) external nonReentrant {
        Battle storage battle = _existingBattle(battleId);
        if (battle.status != Status.Open) revert InvalidStatus(battle.status);
        if (msg.sender != battle.creator) revert NotCreator();

        battle.status = Status.Cancelled;
        emit BattleCancelled(battleId);
        _send(battle.creator, battle.stake);
    }

    /// @notice Full state of a battle. Reverts if it does not exist.
    function getBattle(uint256 battleId) external view returns (Battle memory) {
        return _existingBattle(battleId);
    }

    /// @notice IDs of every battle `player` created or joined, oldest first.
    function battlesOf(address player) external view returns (uint256[] memory) {
        return _playerBattles[player];
    }

    /**
     * @notice Both cards as they were when revealed, so history pages can show
     *         them even after a card is merged away. A side that has not revealed
     *         comes back zeroed; check creatorRevealed and opponentRevealed.
     */
    function getRevealedCards(
        uint256 battleId
    ) external view returns (ElementCards.Card[3] memory creatorCards, ElementCards.Card[3] memory opponentCards) {
        _existingBattle(battleId);
        return (_creatorCards[battleId], _opponentCards[battleId]);
    }

    /**
     * @notice The commitment a player submits. The frontend should compute the
     *         same hash locally with ethers.solidityPackedKeccak256 so the salt
     *         never leaves the browser before the reveal.
     */
    function computeCommitment(uint256[3] memory tokenIds, bytes32 salt, address player) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIds, salt, player));
    }

    /// @notice True if `attacker` is strong against `defender`.
    function beats(ElementCards.Element attacker, ElementCards.Element defender) public pure returns (bool) {
        if (attacker == ElementCards.Element.Water) return defender == ElementCards.Element.Fire;
        if (attacker == ElementCards.Element.Fire) {
            return defender == ElementCards.Element.Grass || defender == ElementCards.Element.Ice;
        }
        if (attacker == ElementCards.Element.Grass) return defender == ElementCards.Element.Ground;
        if (attacker == ElementCards.Element.Ground) return defender == ElementCards.Element.Electric;
        if (attacker == ElementCards.Element.Electric) return defender == ElementCards.Element.Water;
        if (attacker == ElementCards.Element.Ice) return defender == ElementCards.Element.Dragon;
        if (attacker == ElementCards.Element.Dragon) return defender == ElementCards.Element.Dark;
        if (attacker == ElementCards.Element.Dark) return defender == ElementCards.Element.Neutral;
        return false;
    }

    /// @notice Element multiplier in basis points. None never participates.
    function elementMultiplier(
        ElementCards.Element attacker,
        ElementCards.Element defender
    ) public pure returns (uint256) {
        if (attacker == ElementCards.Element.None || defender == ElementCards.Element.None) return 10_000;
        if (beats(attacker, defender)) return 12_500;
        if (beats(defender, attacker)) return 8_000;
        return 10_000;
    }

    /**
     * @notice Only the attacker's primary element attacks. Multiply both defense
     *         elements before clamping the result to 0.70x .. 1.50x.
     */
    function attackMultiplier(
        ElementCards.Card memory attacker,
        ElementCards.Card memory defender
    ) public pure returns (uint256 multiplier) {
        multiplier = elementMultiplier(attacker.element, defender.element);
        if (defender.secondElement != ElementCards.Element.None) {
            multiplier = (multiplier * elementMultiplier(attacker.element, defender.secondElement)) / 10_000;
        }
        if (multiplier < 7_000) return 7_000;
        if (multiplier > 15_000) return 15_000;
    }

    /// @notice Base damage before passives: floor(ATK * E * 100 / (10000 * (100 + DEF))), minimum 1.
    function damage(
        ElementCards.Card memory attacker,
        ElementCards.Card memory defender
    ) public pure returns (uint256) {
        return _baseDamage(attacker, defender, defender.def);
    }

    function _baseDamage(
        ElementCards.Card memory attacker,
        ElementCards.Card memory defender,
        uint256 defense
    ) private pure returns (uint256) {
        uint256 amount = (uint256(attacker.atk) * attackMultiplier(attacker, defender) * 100) /
            (10_000 * (100 + defense));
        return amount == 0 ? 1 : amount;
    }

    /// @dev Read all triggers before reducing either card's HP. Round each stage down.
    function _combatDamage(
        ElementCards.Card memory attacker,
        ElementCards.Card memory defender,
        uint256 hp,
        bool firstAttack,
        uint256 teammates
    ) private pure returns (uint256) {
        uint256 defense = defender.def;
        if (attacker.passive == ElementCards.Passive.Pierce) defense = (defense * 80) / 100;
        uint256 amount = _baseDamage(attacker, defender, defense);
        if (attacker.passive == ElementCards.Passive.Underdog && hp * 2 <= attacker.maxHP) {
            amount = (amount * 120) / 100;
        } else if (attacker.passive == ElementCards.Passive.Resonance) {
            amount = (amount * (100 + teammates * 5)) / 100;
        } else if (attacker.passive == ElementCards.Passive.Focus && firstAttack) {
            amount = (amount * 125) / 100;
        }
        if (defender.passive == ElementCards.Passive.Guard) amount = (amount * 90) / 100;
        return amount == 0 ? 1 : amount;
    }

    /// @dev Count other cards by primary element, including cards already knocked out.
    function _matchingTeammates(
        ElementCards.Card[3] memory team,
        uint256 active
    ) private pure returns (uint256 count) {
        for (uint256 i = 0; i < TEAM_SIZE; i++) {
            if (i != active && team[i].element == team[active].element) count++;
        }
    }

    /// @notice Deterministic simultaneous attacks; after 20 rounds compare remaining HP ratios.
    function simulateBattle(
        ElementCards.Card memory a,
        ElementCards.Card memory b
    ) public pure returns (CombatResult memory result) {
        result.hpA = a.maxHP;
        result.hpB = b.maxHP;
        while (result.rounds < MAX_ROUNDS && result.hpA > 0 && result.hpB > 0) {
            // Both damages are computed before either HP is reduced.
            result.damageA = _combatDamage(a, b, result.hpA, result.rounds == 0, 0);
            result.damageB = _combatDamage(b, a, result.hpB, result.rounds == 0, 0);
            result.hpA = result.damageB >= result.hpA ? 0 : result.hpA - result.damageB;
            result.hpB = result.damageA >= result.hpB ? 0 : result.hpB - result.damageA;
            result.rounds++;
        }
        if (result.hpA == 0 && result.hpB == 0) return result;
        if (result.hpA == 0) result.winner = 2;
        else if (result.hpB == 0) result.winner = 1;
        else {
            uint256 ratioA = result.hpA * uint256(b.maxHP);
            uint256 ratioB = result.hpB * uint256(a.maxHP);
            if (ratioA > ratioB) result.winner = 1;
            else if (ratioB > ratioA) result.winner = 2;
        }
    }

    /// @notice Fixed-order 3v3 relay. Replacement cards first attack on the next round.
    ///         At the global round limit, compare exact sums of remaining HP fractions.
    function simulateTeamBattle(
        ElementCards.Card[3] memory a,
        ElementCards.Card[3] memory b
    ) public pure returns (TeamCombatResult memory result) {
        for (uint256 i = 0; i < TEAM_SIZE; i++) {
            if (a[i].maxHP == 0 || b[i].maxHP == 0) revert InvalidCombatStats();
            result.hpA[i] = a[i].maxHP;
            result.hpB[i] = b[i].maxHP;
        }
        uint256 activeA;
        uint256 activeB;
        bool[3] memory attackedA;
        bool[3] memory attackedB;
        while (result.rounds < MAX_ROUNDS && activeA < TEAM_SIZE && activeB < TEAM_SIZE) {
            uint256 damageA = _combatDamage(
                a[activeA], b[activeB], result.hpA[activeA], !attackedA[activeA], _matchingTeammates(a, activeA)
            );
            uint256 damageB = _combatDamage(
                b[activeB], a[activeA], result.hpB[activeB], !attackedB[activeB], _matchingTeammates(b, activeB)
            );
            attackedA[activeA] = true;
            attackedB[activeB] = true;
            result.hpA[activeA] = damageB >= result.hpA[activeA] ? 0 : result.hpA[activeA] - damageB;
            result.hpB[activeB] = damageA >= result.hpB[activeB] ? 0 : result.hpB[activeB] - damageA;
            result.rounds++;
            if (result.hpA[activeA] == 0) activeA++;
            if (result.hpB[activeB] == 0) activeB++;
        }
        if (activeA == TEAM_SIZE && activeB == TEAM_SIZE) return result;
        if (activeA == TEAM_SIZE) result.winner = 2;
        else if (activeB == TEAM_SIZE) result.winner = 1;
        else {
            // Each maxHP is uint16. Products of six denominators and the summed
            // numerators fit comfortably in uint256; no rounded percentages.
            (uint256 numeratorA, uint256 denominatorA) = _hpFraction(a, result.hpA);
            (uint256 numeratorB, uint256 denominatorB) = _hpFraction(b, result.hpB);
            uint256 scoreA = numeratorA * denominatorB;
            uint256 scoreB = numeratorB * denominatorA;
            if (scoreA > scoreB) result.winner = 1;
            else if (scoreB > scoreA) result.winner = 2;
        }
    }

    function _hpFraction(
        ElementCards.Card[3] memory team,
        uint256[3] memory hp
    ) private pure returns (uint256 numerator, uint256 denominator) {
        denominator = uint256(team[0].maxHP) * team[1].maxHP * team[2].maxHP;
        for (uint256 i = 0; i < TEAM_SIZE; i++) {
            numerator += hp[i] * (denominator / team[i].maxHP);
        }
    }

    /// @dev Use the reveal snapshots; burn/transfer/enchant cannot change the result.
    function _resolve(uint256 battleId) internal {
        TeamCombatResult memory result = simulateTeamBattle(_creatorCards[battleId], _opponentCards[battleId]);
        Battle storage battle = _battles[battleId];
        address winner;
        if (result.winner == 1) winner = battle.creator;
        else if (result.winner == 2) winner = battle.opponent;
        _settle(battleId, winner);
    }

    /**
     * @dev Mark the battle resolved, then pay: the whole pot to `winner`, or each
     *      stake back when `winner` is address(0). State changes come before the
     *      transfers (checks-effects-interactions).
     */
    function _settle(uint256 battleId, address winner) internal {
        Battle storage battle = _battles[battleId];
        battle.status = Status.Resolved;
        battle.winner = winner;

        if (winner == address(0)) {
            emit BattleResolved(battleId, address(0), battle.stake);
            _send(battle.creator, battle.stake);
            _send(battle.opponent, battle.stake);
        } else {
            uint256 pot = battle.stake * 2;
            emit BattleResolved(battleId, winner, pot);
            _send(winner, pot);
        }
    }

    function _existingBattle(uint256 battleId) internal view returns (Battle storage battle) {
        battle = _battles[battleId];
        if (battle.status == Status.None) revert BattleNotFound(battleId);
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        coin.transfer(to, amount);
    }
}
