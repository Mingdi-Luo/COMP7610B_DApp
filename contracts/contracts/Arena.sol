// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ElementCards} from "./ElementCards.sol";
import {GameCoin} from "./GameCoin.sol";

/**
 * @title Arena
 * @notice Staked 1v1 card battles using commit-reveal, so neither player can
 *         see the other's card before choosing their own.
 *
 * Flow: creator commits + stakes coins -> opponent commits + matches the stake ->
 * both reveal within REVEAL_WINDOW -> the contract pays the winner in coins.
 * If only one player reveals in time, that player can claim the whole pot.
 *
 * The contract reads card data from ElementCards, an example of contracts
 * composing with each other. The public interface is frozen; see
 * docs/INTERFACE.md.
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
        uint256 creatorTokenId;
        uint256 opponentTokenId;
        bool creatorRevealed;
        bool opponentRevealed;
        uint64 revealDeadline;
        Status status;
        // Set when the battle is resolved; address(0) means a draw (both refunded).
        address winner;
    }

    uint256 public constant REVEAL_WINDOW = 10 minutes;

    ElementCards public immutable cards;
    GameCoin public immutable coin;

    // Battle IDs start at 1; battleCount is also the latest battle ID.
    uint256 public battleCount;

    mapping(uint256 battleId => Battle) private _battles;

    // Card attributes copied at reveal time, so a player who burns or transfers
    // a revealed card cannot stop the battle from resolving.
    mapping(uint256 battleId => ElementCards.Card) private _creatorCards;
    mapping(uint256 battleId => ElementCards.Card) private _opponentCards;

    // Every battle a player created or joined, oldest first, for history pages.
    mapping(address player => uint256[]) private _playerBattles;

    event BattleCreated(uint256 indexed battleId, address indexed creator, uint256 stake);
    event BattleJoined(uint256 indexed battleId, address indexed opponent, uint64 revealDeadline);
    event CardRevealed(uint256 indexed battleId, address indexed player, uint256 tokenId);
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
    error RevealWindowClosed();
    error RevealWindowOpen();

    constructor(address cardsAddress) {
        cards = ElementCards(cardsAddress);
        coin = cards.coin();
    }

    /**
     * @notice Open a battle, staking coins (0 is a friendly match).
     * @param commitment computeCommitment(tokenId, salt, msg.sender), built in the browser.
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
     * @notice Reveal the committed card. The second reveal resolves the battle.
     * @param salt The random 32 bytes used when committing.
     */
    function reveal(uint256 battleId, uint256 tokenId, bytes32 salt) external nonReentrant {
        Battle storage battle = _existingBattle(battleId);
        if (battle.status != Status.Joined) revert InvalidStatus(battle.status);
        if (block.timestamp > battle.revealDeadline) revert RevealWindowClosed();

        bool isCreator = msg.sender == battle.creator;
        if (!isCreator && msg.sender != battle.opponent) revert NotPlayer();
        if (isCreator ? battle.creatorRevealed : battle.opponentRevealed) revert AlreadyRevealed();

        bytes32 commitment = isCreator ? battle.creatorCommitment : battle.opponentCommitment;
        if (computeCommitment(tokenId, salt, msg.sender) != commitment) revert CommitmentMismatch();
        // ownerOf reverts with ERC721NonexistentToken if the card was burned.
        if (cards.ownerOf(tokenId) != msg.sender) revert NotCardOwner(tokenId);

        ElementCards.Card memory card = cards.getCard(tokenId);
        if (isCreator) {
            battle.creatorTokenId = tokenId;
            battle.creatorRevealed = true;
            _creatorCards[battleId] = card;
        } else {
            battle.opponentTokenId = tokenId;
            battle.opponentRevealed = true;
            _opponentCards[battleId] = card;
        }
        emit CardRevealed(battleId, msg.sender, tokenId);

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
    ) external view returns (ElementCards.Card memory creatorCard, ElementCards.Card memory opponentCard) {
        _existingBattle(battleId);
        return (_creatorCards[battleId], _opponentCards[battleId]);
    }

    /**
     * @notice The commitment a player submits. The frontend should compute the
     *         same hash locally with ethers.solidityPackedKeccak256 so the salt
     *         never leaves the browser before the reveal.
     */
    function computeCommitment(uint256 tokenId, bytes32 salt, address player) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenId, salt, player));
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

    /**
     * @notice Damage percent of one element against another: 200 if it is strong,
     *         50 if the defender is strong against it, otherwise 100. Neutral always
     *         attacks at 100, and an element attacks itself at 100.
     */
    function elementMultiplier(
        ElementCards.Element attacker,
        ElementCards.Element defender
    ) public pure returns (uint256) {
        if (attacker == ElementCards.Element.Neutral) return 100;
        if (beats(attacker, defender)) return 200;
        if (beats(defender, attacker)) return 50;
        return 100;
    }

    /**
     * @notice Damage percent of `attacker` against `defender`. A card attacks with
     *         its first element; a dual-element defender multiplies both results,
     *         so two strengths make 400 and a strength plus a resistance make 100.
     */
    function attackMultiplier(
        ElementCards.Card memory attacker,
        ElementCards.Card memory defender
    ) public pure returns (uint256 percent) {
        percent = elementMultiplier(attacker.element, defender.element);
        if (defender.secondElement != defender.element) {
            percent = (percent * elementMultiplier(attacker.element, defender.secondElement)) / 100;
        }
    }

    /**
     * @notice Power of `card` against `enemy`, after the element multiplier and passive.
     *         Pierce: a resisted attack still deals 100%.
     *         Underdog: +30% if the card's power is below the enemy's.
     *         Resonance: +20% if the two cards share an element.
     *         Guard: +25% if the enemy is strong against this card.
     *         Focus: +10% always.
     */
    function battlePower(
        ElementCards.Card memory card,
        ElementCards.Card memory enemy
    ) public pure returns (uint256) {
        uint256 multiplier = attackMultiplier(card, enemy);
        uint256 bonus;
        if (card.passive == ElementCards.Passive.Pierce && multiplier < 100) {
            multiplier = 100;
        } else if (card.passive == ElementCards.Passive.Underdog && card.power < enemy.power) {
            bonus = 30;
        } else if (card.passive == ElementCards.Passive.Resonance && _shareElement(card, enemy)) {
            bonus = 20;
        } else if (card.passive == ElementCards.Passive.Guard && attackMultiplier(enemy, card) > 100) {
            bonus = 25;
        } else if (card.passive == ElementCards.Passive.Focus) {
            bonus = 10;
        }
        return (uint256(card.power) * multiplier * (100 + bonus)) / 10_000;
    }

    /// @dev Compare the two revealed cards. Higher power wins 2 * stake; a tie refunds both players.
    function _resolve(uint256 battleId) internal {
        ElementCards.Card memory creatorCard = _creatorCards[battleId];
        ElementCards.Card memory opponentCard = _opponentCards[battleId];
        uint256 creatorPower = battlePower(creatorCard, opponentCard);
        uint256 opponentPower = battlePower(opponentCard, creatorCard);

        Battle storage battle = _battles[battleId];
        address winner;
        if (creatorPower > opponentPower) winner = battle.creator;
        else if (opponentPower > creatorPower) winner = battle.opponent;
        _settle(battleId, winner);
    }

    function _shareElement(
        ElementCards.Card memory a,
        ElementCards.Card memory b
    ) private pure returns (bool) {
        return
            a.element == b.element ||
            a.element == b.secondElement ||
            a.secondElement == b.element ||
            a.secondElement == b.secondElement;
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
