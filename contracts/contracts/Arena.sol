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
 * docs/INTERFACE.md. Bodies marked TODO belong to the contract team.
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

    event BattleCreated(uint256 indexed battleId, address indexed creator, uint256 stake);
    event BattleJoined(uint256 indexed battleId, address indexed opponent, uint64 revealDeadline);
    event CardRevealed(uint256 indexed battleId, address indexed player, uint256 tokenId);
    event BattleResolved(uint256 indexed battleId, address indexed winner, uint256 payout);
    event BattleCancelled(uint256 indexed battleId);

    error NotImplemented();
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
        // TODO(contract team): battleId = ++battleCount; store creator, stake,
        // commitment and Status.Open; emit BattleCreated.
        commitment;
        battleId;
        revert NotImplemented();
    }

    /// @notice Join an open battle by sending exactly the same stake.
    function joinBattle(uint256 battleId, bytes32 commitment) external payable nonReentrant {
        // TODO(contract team): require Status.Open (InvalidStatus), caller is not
        // the creator (CannotJoinOwnBattle), msg.value == stake (StakeMismatch).
        // Store opponent + commitment, set Status.Joined and
        // revealDeadline = block.timestamp + REVEAL_WINDOW; emit BattleJoined.
        battleId;
        commitment;
        revert NotImplemented();
    }

    /**
     * @notice Reveal the committed card. The second reveal resolves the battle.
     * @param salt The random 32 bytes used when committing.
     */
    function reveal(uint256 battleId, uint256 tokenId, bytes32 salt) external nonReentrant {
        // TODO(contract team): require Status.Joined and the reveal window still
        // open; caller is creator or opponent (NotPlayer) and has not revealed
        // (AlreadyRevealed); computeCommitment(tokenId, salt, msg.sender) must
        // equal the stored commitment (CommitmentMismatch); the caller must
        // still own tokenId (NotCardOwner). Record it, emit CardRevealed, and
        // call _resolve once both players have revealed.
        battleId;
        tokenId;
        salt;
        revert NotImplemented();
    }

    /**
     * @notice After the reveal window, settle a battle where a player did not reveal.
     *         Exactly one reveal: that player takes the pot. No reveals: both refunded.
     */
    function claimTimeout(uint256 battleId) external nonReentrant {
        // TODO(contract team): require Status.Joined and the window closed
        // (RevealWindowOpen); pay out as described; emit BattleResolved.
        battleId;
        revert NotImplemented();
    }

    /// @notice The creator takes back the stake if nobody has joined yet.
    function cancelBattle(uint256 battleId) external nonReentrant {
        // TODO(contract team): require Status.Open and msg.sender == creator
        // (NotCreator); set Status.Cancelled before refunding; emit BattleCancelled.
        battleId;
        revert NotImplemented();
    }

    /// @notice Full state of a battle. Reverts if it does not exist.
    function getBattle(uint256 battleId) external view returns (Battle memory) {
        Battle memory battle = _battles[battleId];
        if (battle.status == Status.None) revert BattleNotFound(battleId);
        return battle;
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
        // TODO(contract team): read both cards with cards.getCard(...), apply
        // beats() (power * 3 / 2), set winner and Status.Resolved BEFORE sending
        // ETH (checks-effects-interactions), then pay with _send.
        battleId;
        revert NotImplemented();
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
