// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ElementCards
 * @notice Collectible card NFTs for Elemental Duel. Players buy packs with ETH
 *         to mint random cards, and merge three cards of one rarity into one
 *         card of the next rarity.
 *
 * The public interface (functions, events, errors) is frozen so the frontend
 * can be built in parallel; see docs/INTERFACE.md. Bodies marked TODO belong to
 * the contract team (docs/PLAN.md).
 */
contract ElementCards is ERC721Enumerable, Ownable {
    // Fire beats Wood, Wood beats Water, Water beats Fire.
    enum Element {
        Fire,
        Water,
        Wood
    }

    enum Rarity {
        Common,
        Rare,
        Legendary
    }

    struct Card {
        Element element;
        Rarity rarity;
        uint8 power;
    }

    uint256 public constant PACK_PRICE = 0.001 ether;

    // Drop rates in basis points (1 bp = 0.01%). They must add up to 10_000.
    // Public constants let anyone audit the odds on-chain.
    uint16 public constant COMMON_RATE_BP = 7_000;
    uint16 public constant RARE_RATE_BP = 2_500;
    uint16 public constant LEGENDARY_RATE_BP = 500;

    // Token IDs start at 1 so that 0 never refers to a real card.
    uint256 private _nextTokenId = 1;

    // Mixed into the pseudo-random seed so two mints in one block differ.
    uint256 private _nonce;

    mapping(uint256 tokenId => Card) private _cards;

    event PackOpened(address indexed player, uint256 indexed tokenId, Element element, Rarity rarity, uint8 power);
    event CardsMerged(address indexed player, uint256[3] burnedTokenIds, uint256 indexed newTokenId);

    error NotImplemented();
    error WrongPayment(uint256 sent, uint256 required);
    error NotCardOwner(uint256 tokenId);
    error DuplicateCard(uint256 tokenId);
    error RarityMismatch();
    error CannotMergeLegendary();
    error WithdrawFailed();

    constructor() ERC721("Elemental Duel Card", "EDC") Ownable(msg.sender) {}

    /**
     * @notice Pay exactly PACK_PRICE to mint one random card to the caller.
     * @return tokenId The ID of the new card.
     */
    function openPack() external payable returns (uint256 tokenId) {
        // TODO(contract team):
        // 1. Revert with WrongPayment unless msg.value == PACK_PRICE.
        // 2. Roll a rarity with the drop rates above (_random() % 10_000).
        // 3. tokenId = _mintCard(msg.sender, rarity);
        // 4. Emit PackOpened with the new card's attributes.
        tokenId;
        revert NotImplemented();
    }

    /**
     * @notice Burn three cards of the same rarity and mint one card of the next rarity.
     * @param tokenIds Three distinct cards owned by the caller.
     * @return newTokenId The ID of the upgraded card.
     */
    function merge(uint256[3] calldata tokenIds) external returns (uint256 newTokenId) {
        // TODO(contract team):
        // 1. Each card must be owned by msg.sender (NotCardOwner) and the three
        //    IDs must differ (DuplicateCard).
        // 2. All three must share a rarity (RarityMismatch), and Legendary cards
        //    cannot be merged (CannotMergeLegendary).
        // 3. Burn the three cards and delete their _cards entries.
        // 4. newTokenId = _mintCard(msg.sender, nextRarity);
        // 5. Emit CardsMerged(msg.sender, tokenIds, newTokenId).
        tokenIds;
        newTokenId;
        revert NotImplemented();
    }

    /// @notice Attributes of an existing card. Reverts if the card does not exist.
    function getCard(uint256 tokenId) external view returns (Card memory) {
        _requireOwned(tokenId);
        return _cards[tokenId];
    }

    /// @notice All card IDs currently owned by `owner`.
    function cardsOf(address owner) external view returns (uint256[] memory tokenIds) {
        uint256 count = balanceOf(owner);
        tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
    }

    /// @notice Drop rate of a rarity, in basis points.
    function dropRate(Rarity rarity) public pure returns (uint16) {
        if (rarity == Rarity.Common) return COMMON_RATE_BP;
        if (rarity == Rarity.Rare) return RARE_RATE_BP;
        return LEGENDARY_RATE_BP;
    }

    /// @notice Inclusive power range of a rarity.
    function powerRange(Rarity rarity) public pure returns (uint8 min, uint8 max) {
        if (rarity == Rarity.Common) return (10, 39);
        if (rarity == Rarity.Rare) return (40, 69);
        return (70, 100);
    }

    /// @notice Send all pack revenue held by the contract to the owner.
    function withdraw() external onlyOwner {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        if (!ok) revert WithdrawFailed();
    }

    /**
     * @dev Mint a card of `rarity` with a random element and a random power
     *      inside powerRange(rarity), and store its attributes.
     */
    function _mintCard(address to, Rarity rarity) internal returns (uint256 tokenId) {
        // TODO(contract team): pick element and power with _random(), store the
        // Card in _cards, then _safeMint(to, tokenId). Use _nextTokenId++.
        to;
        rarity;
        tokenId;
        revert NotImplemented();
    }

    /**
     * @dev Pseudo-random number from block data. Good enough for a course demo,
     *      but validators can influence it; production games use Chainlink VRF.
     */
    function _random() internal returns (uint256) {
        // TODO(contract team): hash block.prevrandao, block.timestamp,
        // msg.sender and ++_nonce with keccak256(abi.encodePacked(...)).
        _nonce;
        revert NotImplemented();
    }
}
