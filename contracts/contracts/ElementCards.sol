// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {GameCoin} from "./GameCoin.sol";

/**
 * @title ElementCards
 * @notice Creature card NFTs for Elemental Duel. Players spend GameCoin to open
 *         packs, enchant cards with a random passive and breed new cards. They
 *         can merge three cards into a rarer one, or decompose a card for coins.
 *
 * Species stats live here; their names live in frontend/src/config/species.js,
 * so a creature can be renamed without redeploying. See docs/INTERFACE.md.
 */
contract ElementCards is ERC721Enumerable {
    enum Element {
        Neutral,
        Fire,
        Water,
        Grass,
        Electric,
        Ground,
        Ice,
        Dragon,
        Dark
    }

    enum Rarity {
        Common,
        Rare,
        Legendary
    }

    // Each is rolled at random by enchant(); Arena applies the effects.
    enum Passive {
        None,
        Pierce,
        Underdog,
        Resonance,
        Guard,
        Focus
    }

    // Rolled at random when a card is minted. Breeding needs one of each.
    enum Gender {
        Male,
        Female
    }

    // secondElement equals element for a single-element species.
    struct Species {
        Element element;
        Element secondElement;
        Rarity rarity;
        uint8 basePower;
        uint16 breedRank;
    }

    struct Card {
        uint8 speciesId;
        Element element;
        Element secondElement;
        Rarity rarity;
        uint8 power;
        Passive passive;
        Gender gender;
        uint8 generation;
        uint64 breedReadyAt;
    }

    uint256 public constant PACK_PRICE = 1_000;

    // Drop rates in basis points (1 bp = 0.01%). They must add up to 10_000.
    // Public constants let anyone audit the odds on-chain.
    uint16 public constant COMMON_RATE_BP = 7_000;
    uint16 public constant RARE_RATE_BP = 2_500;
    uint16 public constant LEGENDARY_RATE_BP = 500;

    // A card's power is its species' basePower plus 0 to POWER_SPREAD - 1.
    uint8 public constant POWER_SPREAD = 12;

    // A parent waits this long, multiplied by its generation + 1, between breedings.
    uint256 public constant BREED_COOLDOWN = 1 minutes;

    uint8 private constant PASSIVE_COUNT = 5;

    GameCoin public immutable coin;

    // Token IDs start at 1 so that 0 never refers to a real card.
    uint256 private _nextTokenId = 1;

    // Mixed into the pseudo-random seed so two mints in one block differ.
    uint256 private _nonce;

    mapping(uint256 tokenId => Card) private _cards;

    Species[] private _species;
    mapping(Rarity rarity => uint8[] speciesIds) private _speciesByRarity;

    // Special breeding recipes. Values are the child's species ID + 1, so 0 means no recipe.
    mapping(bytes32 parents => uint8 childPlusOne) private _recipes;

    event PackOpened(address indexed player, uint256 indexed tokenId, uint8 speciesId, Rarity rarity, uint8 power);
    event CardsMerged(address indexed player, uint256[3] burnedTokenIds, uint256 indexed newTokenId);
    event CardDecomposed(address indexed player, uint256 indexed tokenId, uint256 coins);
    event CardEnchanted(address indexed player, uint256 indexed tokenId, Passive passive);
    event CardBred(address indexed player, uint256 parentA, uint256 parentB, uint256 indexed childId, uint8 speciesId);

    error NotCardOwner(uint256 tokenId);
    error DuplicateCard(uint256 tokenId);
    error RarityMismatch();
    error CannotMergeLegendary();
    error UnknownSpecies(uint256 speciesId);
    error BreedOnCooldown(uint256 tokenId, uint64 readyAt);
    error SameGender();

    constructor(address coinAddress) ERC721("Elemental Duel Card", "EDC") {
        coin = GameCoin(coinAddress);

        // Species IDs follow this order. Common ranks are lowest and Legendary highest,
        // so parents of different rarities tend to breed something in between.
        _addSpecies(Element.Neutral, Element.Neutral, Rarity.Common, 20, 100); //     0 Puffkin
        _addSpecies(Element.Neutral, Element.Neutral, Rarity.Rare, 50, 300); //       1 Driftmane
        _addSpecies(Element.Neutral, Element.Neutral, Rarity.Legendary, 80, 500); //  2 Halcyra
        _addSpecies(Element.Fire, Element.Fire, Rarity.Common, 22, 110); //           3 Emberkit
        _addSpecies(Element.Fire, Element.Fire, Rarity.Rare, 54, 310); //             4 Cindrake
        _addSpecies(Element.Fire, Element.Dragon, Rarity.Legendary, 86, 510); //      5 Pyrovane
        _addSpecies(Element.Water, Element.Water, Rarity.Common, 18, 120); //         6 Ripplet
        _addSpecies(Element.Water, Element.Water, Rarity.Rare, 48, 320); //           7 Tidewarden
        _addSpecies(Element.Water, Element.Water, Rarity.Legendary, 82, 520); //      8 Abyssara
        _addSpecies(Element.Grass, Element.Grass, Rarity.Common, 16, 130); //         9 Sproutle
        _addSpecies(Element.Grass, Element.Ground, Rarity.Rare, 46, 330); //         10 Thornback
        _addSpecies(Element.Grass, Element.Grass, Rarity.Legendary, 78, 530); //     11 Verdantis
        _addSpecies(Element.Electric, Element.Electric, Rarity.Common, 20, 140); //  12 Zapling
        _addSpecies(Element.Electric, Element.Electric, Rarity.Rare, 52, 340); //    13 Voltarch
        _addSpecies(Element.Electric, Element.Dragon, Rarity.Legendary, 84, 540); // 14 Stormregent
        _addSpecies(Element.Ground, Element.Ground, Rarity.Common, 24, 150); //      15 Burrowpaw
        _addSpecies(Element.Ground, Element.Dark, Rarity.Rare, 50, 350); //          16 Cragmaw
        _addSpecies(Element.Ground, Element.Ground, Rarity.Legendary, 80, 550); //   17 Terravault
        _addSpecies(Element.Ice, Element.Ice, Rarity.Common, 18, 160); //            18 Frostlet
        _addSpecies(Element.Ice, Element.Water, Rarity.Rare, 48, 360); //            19 Rimefang
        _addSpecies(Element.Ice, Element.Dark, Rarity.Legendary, 82, 560); //        20 Cryomere
        _addSpecies(Element.Dragon, Element.Dragon, Rarity.Common, 24, 170); //      21 Wyrmlet
        _addSpecies(Element.Dragon, Element.Dark, Rarity.Rare, 56, 370); //          22 Drakeshade
        _addSpecies(Element.Dragon, Element.Dragon, Rarity.Legendary, 86, 570); //   23 Aethwyrm
        _addSpecies(Element.Dark, Element.Dark, Rarity.Common, 20, 180); //          24 Gloomlet
        _addSpecies(Element.Dark, Element.Dark, Rarity.Rare, 52, 380); //            25 Umbralynx
        _addSpecies(Element.Dark, Element.Dark, Rarity.Legendary, 84, 580); //       26 Nocthrone

        // The only way to breed these Legendary cards from two Rare parents.
        _recipes[_recipeKey(4, 7)] = 5 + 1; //    Cindrake + Tidewarden -> Pyrovane
        _recipes[_recipeKey(13, 16)] = 14 + 1; // Voltarch + Cragmaw    -> Stormregent
        _recipes[_recipeKey(19, 22)] = 20 + 1; // Rimefang + Drakeshade -> Cryomere
    }

    /**
     * @notice Pay PACK_PRICE coins to mint one random card to the caller.
     * @return tokenId The ID of the new card.
     */
    function openPack() external returns (uint256 tokenId) {
        coin.spend(msg.sender, PACK_PRICE);
        tokenId = _mintRandomSpecies(msg.sender, _rollRarity());
        Card memory card = _cards[tokenId];
        emit PackOpened(msg.sender, tokenId, card.speciesId, card.rarity, card.power);
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
            _requireCardOwner(tokenId);
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

        newTokenId = _mintRandomSpecies(msg.sender, Rarity(uint8(rarity) + 1));
        emit CardsMerged(msg.sender, tokenIds, newTokenId);
    }

    /**
     * @notice Burn a card for coins, worth less than the coins it took to get it.
     * @return coins The number of coins paid to the caller.
     */
    function decompose(uint256 tokenId) external returns (uint256 coins) {
        _requireCardOwner(tokenId);
        coins = decomposeValue(_cards[tokenId].rarity);
        _burn(tokenId);
        delete _cards[tokenId];
        coin.reward(msg.sender, coins);
        emit CardDecomposed(msg.sender, tokenId, coins);
    }

    /**
     * @notice Pay coins to give a card a random passive, replacing any it already has.
     * @return passive The passive the card now has.
     */
    function enchant(uint256 tokenId) external returns (Passive passive) {
        _requireCardOwner(tokenId);
        Card storage card = _cards[tokenId];
        coin.spend(msg.sender, enchantCost(card.rarity));
        // Passive.None is never rolled.
        passive = Passive((_random() % PASSIVE_COUNT) + 1);
        card.passive = passive;
        emit CardEnchanted(msg.sender, tokenId, passive);
    }

    /**
     * @notice Pay coins to breed a male and a female card of yours, in either order.
     *         The parents stay yours but need to rest before breeding again.
     *         See breedResult for the formula.
     * @return childId The ID of the new card.
     */
    function breed(uint256 parentA, uint256 parentB) external returns (uint256 childId) {
        if (parentA == parentB) revert DuplicateCard(parentA);
        Card storage a = _readyParent(parentA);
        Card storage b = _readyParent(parentB);
        if (a.gender == b.gender) revert SameGender();

        uint8 childSpecies = breedResult(a.speciesId, b.speciesId);
        coin.spend(msg.sender, breedFee(_species[childSpecies].rarity));

        a.breedReadyAt = uint64(block.timestamp + BREED_COOLDOWN * (uint256(a.generation) + 1));
        b.breedReadyAt = uint64(block.timestamp + BREED_COOLDOWN * (uint256(b.generation) + 1));
        uint8 oldest = a.generation > b.generation ? a.generation : b.generation;
        uint8 generation = oldest == type(uint8).max ? oldest : oldest + 1;

        childId = _mintSpecies(msg.sender, childSpecies, generation);
        emit CardBred(msg.sender, parentA, parentB, childId, childSpecies);
    }

    /**
     * @notice The species two parents breed. A special recipe wins if one exists;
     *         otherwise it is the species whose breedRank is closest to the average
     *         of the parents' ranks, with ties going to the lower species ID.
     */
    function breedResult(uint256 speciesA, uint256 speciesB) public view returns (uint8 childSpecies) {
        if (speciesA >= _species.length) revert UnknownSpecies(speciesA);
        if (speciesB >= _species.length) revert UnknownSpecies(speciesB);

        uint8 recipe = _recipes[_recipeKey(speciesA, speciesB)];
        if (recipe != 0) return recipe - 1;

        uint256 target = (uint256(_species[speciesA].breedRank) + _species[speciesB].breedRank) / 2;
        uint256 bestDistance = type(uint256).max;
        for (uint256 id = 0; id < _species.length; id++) {
            uint256 rank = _species[id].breedRank;
            uint256 distance = rank > target ? rank - target : target - rank;
            if (distance < bestDistance) {
                bestDistance = distance;
                childSpecies = uint8(id);
            }
        }
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

    /// @notice Stats of one species. Reverts for an unknown ID.
    function getSpecies(uint256 speciesId) external view returns (Species memory) {
        if (speciesId >= _species.length) revert UnknownSpecies(speciesId);
        return _species[speciesId];
    }

    function speciesCount() external view returns (uint256) {
        return _species.length;
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

    /**
     * @notice Coins paid for decomposing a card. Each rarity is worth three of the
     *         one below, so merging and then decomposing never makes coins.
     */
    function decomposeValue(Rarity rarity) public pure returns (uint256) {
        if (rarity == Rarity.Common) return 300;
        if (rarity == Rarity.Rare) return 900;
        return 2_700;
    }

    /// @notice Coins it costs to enchant a card.
    function enchantCost(Rarity rarity) public pure returns (uint256) {
        if (rarity == Rarity.Common) return 200;
        if (rarity == Rarity.Rare) return 500;
        return 1_000;
    }

    /**
     * @notice Coins it costs to breed a child of this rarity. Always above its
     *         decomposeValue, so breeding and then decomposing never makes coins.
     */
    function breedFee(Rarity rarity) public pure returns (uint256) {
        if (rarity == Rarity.Common) return 500;
        if (rarity == Rarity.Rare) return 1_500;
        return 4_500;
    }

    function _addSpecies(
        Element element,
        Element secondElement,
        Rarity rarity,
        uint8 basePower,
        uint16 breedRank
    ) private {
        _speciesByRarity[rarity].push(uint8(_species.length));
        _species.push(Species(element, secondElement, rarity, basePower, breedRank));
    }

    /// @dev The same key for either parent order.
    function _recipeKey(uint256 speciesA, uint256 speciesB) private pure returns (bytes32) {
        (uint256 low, uint256 high) = speciesA < speciesB ? (speciesA, speciesB) : (speciesB, speciesA);
        return keccak256(abi.encode(low, high));
    }

    function _requireCardOwner(uint256 tokenId) private view {
        if (_ownerOf(tokenId) != msg.sender) revert NotCardOwner(tokenId);
    }

    function _readyParent(uint256 tokenId) private view returns (Card storage card) {
        _requireCardOwner(tokenId);
        card = _cards[tokenId];
        if (block.timestamp < card.breedReadyAt) revert BreedOnCooldown(tokenId, card.breedReadyAt);
    }

    /// @dev Roll a rarity using the published drop rates.
    function _rollRarity() private returns (Rarity) {
        uint256 roll = _random() % 10_000;
        if (roll < LEGENDARY_RATE_BP) return Rarity.Legendary;
        if (roll < LEGENDARY_RATE_BP + RARE_RATE_BP) return Rarity.Rare;
        return Rarity.Common;
    }

    function _mintRandomSpecies(address to, Rarity rarity) private returns (uint256) {
        uint8[] storage ids = _speciesByRarity[rarity];
        return _mintSpecies(to, ids[_random() % ids.length], 0);
    }

    /// @dev Mint a card of a species with a random power and gender, and no passive.
    function _mintSpecies(address to, uint8 speciesId, uint8 generation) private returns (uint256) {
        Species memory species = _species[speciesId];
        uint8 power = species.basePower + uint8(_random() % POWER_SPREAD);
        Gender gender = Gender(_random() % 2);
        return
            _issueCard(
                to,
                Card(
                    speciesId,
                    species.element,
                    species.secondElement,
                    species.rarity,
                    power,
                    Passive.None,
                    gender,
                    generation,
                    0
                )
            );
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
    function _random() private returns (uint256) {
        return uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, ++_nonce)));
    }
}
