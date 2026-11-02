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
 * can be built in parallel; see docs/INTERFACE.md.
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
        if (msg.value != PACK_PRICE) revert WrongPayment(msg.value, PACK_PRICE);

        tokenId = _mintCard(msg.sender, _rollRarity());
        Card memory card = _cards[tokenId];
        emit PackOpened(msg.sender, tokenId, card.element, card.rarity, card.power);
    }

    /**
     * @notice Burn three cards of the same rarity and mint one card of the next rarity.
     * @param tokenIds Three distinct cards owned by the caller.
     * @return newTokenId The ID of the upgraded card.
     */
    function merge(uint256[3] calldata tokenIds) external returns (uint256 newTokenId) {
        // Check every card before burning any of them.
        Rarity rarity = _cards[tokenIds[0]].rarity;
        for (uint256 i = 0; i < 3; i++) {
            uint256 tokenId = tokenIds[i];
            if (_ownerOf(tokenId) != msg.sender) revert NotCardOwner(tokenId);
            for (uint256 j = 0; j < i; j++) {
                if (tokenIds[j] == tokenId) revert DuplicateCard(tokenId);
            }
            if (_cards[tokenId].rarity != rarity) revert RarityMismatch();
        }
        if (rarity == Rarity.Legendary) revert CannotMergeLegendary();

        for (uint256 i = 0; i < 3; i++) {
            _burn(tokenIds[i]);
            delete _cards[tokenIds[i]];
        }

        newTokenId = _mintCard(msg.sender, Rarity(uint8(rarity) + 1));
        emit CardsMerged(msg.sender, tokenIds, newTokenId);
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

    /// @dev Roll a rarity using the published drop rates.
    function _rollRarity() internal returns (Rarity) {
        uint256 roll = _random() % 10_000;
        if (roll < LEGENDARY_RATE_BP) return Rarity.Legendary;
        if (roll < LEGENDARY_RATE_BP + RARE_RATE_BP) return Rarity.Rare;
        return Rarity.Common;
    }

    /**
     * @dev Mint a card of `rarity` with a random element and a random power
     *      inside powerRange(rarity).
     */
    function _mintCard(address to, Rarity rarity) internal returns (uint256 tokenId) {
        uint256 seed = _random();
        (uint8 min, uint8 max) = powerRange(rarity);
        // Different bits of the seed for the element and the power.
        uint256 power = min + ((seed >> 8) % (uint256(max) - min + 1));
        return _issueCard(to, Card(Element(seed % 3), rarity, uint8(power)));
    }

    /// @dev Store `card` under the next token ID and mint it to `to`.
    function _issueCard(address to, Card memory card) internal returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        // Store the attributes first: _safeMint may call into `to`.
        _cards[tokenId] = card;
        _safeMint(to, tokenId);
    }

    /**
     * @dev Pseudo-random number from block data. Good enough for a course demo,
     *      but validators can influence it; production games use Chainlink VRF.
     */
    function _random() internal returns (uint256) {
        return uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, ++_nonce)));
    }
}
