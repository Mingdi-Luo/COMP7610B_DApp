// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ElementCards} from "./ElementCards.sol";

/**
 * @title Arena
 * @notice Staked 1v1 card battles using commit-reveal, so neither player can
 *         see the other's card before choosing their own.
 *
 * Flow: creator commits + stakes -> opponent commits + matches the stake ->
 * both reveal within REVEAL_WINDOW -> the contract pays the winner.
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
    error StakeMismatch(uint256 sent, uint256 required);
    error CannotJoinOwnBattle();
    error NotPlayer();
    error NotCreator();
    error AlreadyRevealed();
    error CommitmentMismatch();
    error NotCardOwner(uint256 tokenId);
    error RevealWindowClosed();
    error RevealWindowOpen();
    error TransferFailed();

    constructor(address cardsAddress) {
        cards = ElementCards(cardsAddress);
    }

    /**
     * @notice Open a battle. The ETH sent becomes the stake (0 is a friendly match).
     * @param commitment computeCommitment(tokenId, salt, msg.sender), built in the browser.
     */
    function createBattle(bytes32 commitment) external payable returns (uint256 battleId) {
        battleId = ++battleCount;
        Battle storage battle = _battles[battleId];
        battle.creator = msg.sender;
        battle.stake = msg.value;
        battle.creatorCommitment = commitment;
        battle.status = Status.Open;
        _playerBattles[msg.sender].push(battleId);
        emit BattleCreated(battleId, msg.sender, msg.value);
    }

    /// @notice Join an open battle by sending exactly the same stake.
    function joinBattle(uint256 battleId, bytes32 commitment) external payable nonReentrant {
        Battle storage battle = _existingBattle(battleId);
        if (battle.status != Status.Open) revert InvalidStatus(battle.status);
        if (msg.sender == battle.creator) revert CannotJoinOwnBattle();
        if (msg.value != battle.stake) revert StakeMismatch(msg.value, battle.stake);

        uint64 deadline = uint64(block.timestamp + REVEAL_WINDOW);
        battle.opponent = msg.sender;
        battle.opponentCommitment = commitment;
        battle.revealDeadline = deadline;
        battle.status = Status.Joined;
        _playerBattles[msg.sender].push(battleId);
        emit BattleJoined(battleId, msg.sender, deadline);
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

    /// @notice True if `attacker` has the element advantage over `defender`.
    function beats(ElementCards.Element attacker, ElementCards.Element defender) public pure returns (bool) {
        return
            (attacker == ElementCards.Element.Fire && defender == ElementCards.Element.Wood) ||
            (attacker == ElementCards.Element.Wood && defender == ElementCards.Element.Water) ||
            (attacker == ElementCards.Element.Water && defender == ElementCards.Element.Fire);
    }

    /**
     * @dev Compare the two revealed cards and pay out. A card with the element
     *      advantage fights at 1.5x power. Higher power wins 2 * stake; a tie
     *      refunds both players.
     */
    function _resolve(uint256 battleId) internal {
        ElementCards.Card memory creatorCard = _creatorCards[battleId];
        ElementCards.Card memory opponentCard = _opponentCards[battleId];
        uint256 creatorPower = _battlePower(creatorCard, opponentCard);
        uint256 opponentPower = _battlePower(opponentCard, creatorCard);

        Battle storage battle = _battles[battleId];
        address winner;
        if (creatorPower > opponentPower) winner = battle.creator;
        else if (opponentPower > creatorPower) winner = battle.opponent;
        _settle(battleId, winner);
    }

    /// @dev Power of `card` against `enemy`, including the element advantage.
    function _battlePower(
        ElementCards.Card memory card,
        ElementCards.Card memory enemy
    ) internal pure returns (uint256) {
        if (beats(card.element, enemy.element)) return (uint256(card.power) * 3) / 2;
        return card.power;
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
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
