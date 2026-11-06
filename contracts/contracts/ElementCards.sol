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
        Dark,
        None
    }

    enum Rarity {
        Common,
        Rare,
        Legendary
    }

    // One passive per card. Arena applies its deterministic battle effect.
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

    // None is distinct from Neutral; it never contributes a defense multiplier.
    struct Species {
        Element element;
        Element secondElement;
        Rarity rarity;
        uint8 basePower;
        uint16 breedRank;
        uint16 maxHP;
        uint16 atk;
        uint16 def;
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
        uint16 maxHP;
        uint16 atk;
        uint16 def;
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

        // Species IDs follow this order. Generated from palworld-dataset.json.
        // Order locked by scripts/species-order.json; rarity and power are economic metadata only.
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 3050, 70, 70, 70); // 0: SheepBall -> lamball
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2760, 70, 70, 70); // 1: PinkCat -> cattiva
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 3080, 60, 60, 60); // 2: ChickenPal -> chikipi
        _addSpecies(Element.Grass, Element.None, Rarity.Common, 20, 3020, 75, 70, 70); // 3: Carbunclo -> lifmunk
        _addSpecies(Element.Water, Element.None, Rarity.Common, 20, 2980, 60, 80, 60); // 4: BluePlatypus -> fuack
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 3060, 70, 70, 70); // 5: CuteFox -> vixy
        _addSpecies(Element.Water, Element.None, Rarity.Common, 20, 2740, 80, 70, 80); // 6: FlyingManta -> celaray
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2890, 70, 70, 75); // 7: WoolFox -> cremis
        _addSpecies(Element.Water, Element.None, Rarity.Common, 20, 3070, 70, 60, 70); // 8: Ganesha -> teafant
        _addSpecies(Element.Grass, Element.Ground, Rarity.Common, 20, 2950, 70, 70, 70); // 9: PlantSlime -> gumoss
        _addSpecies(Element.Electric, Element.None, Rarity.Common, 20, 3030, 70, 75, 70); // 10: Hedgehog -> jolthog
        _addSpecies(Element.Ice, Element.None, Rarity.Common, 20, 2850, 70, 75, 80); // 11: Hedgehog_Ice -> jolthog-cryst
        _addSpecies(Element.Dark, Element.None, Rarity.Common, 20, 3000, 70, 70, 70); // 12: NegativeKoala -> depresso
        _addSpecies(Element.Water, Element.Ice, Rarity.Common, 20, 2960, 70, 75, 70); // 13: Penguin -> pengullet
        _addSpecies(Element.Water, Element.Ice, Rarity.Rare, 50, 2070, 95, 95, 95); // 14: CaptainPenguin -> penking
        _addSpecies(Element.Dark, Element.None, Rarity.Common, 20, 2940, 70, 70, 80); // 15: WizardOwl -> hoocrates
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2720, 90, 75, 90); // 16: Alpaca -> melpaca
        _addSpecies(Element.Neutral, Element.None, Rarity.Rare, 50, 2220, 120, 85, 90); // 17: KingAlpaca -> kingpaca
        _addSpecies(Element.Ice, Element.None, Rarity.Rare, 50, 1530, 120, 85, 90); // 18: KingAlpaca_Ice -> kingpaca-cryst
        _addSpecies(Element.Dark, Element.None, Rarity.Common, 20, 2910, 70, 75, 60); // 19: DreamDemon -> daedream
        _addSpecies(Element.Grass, Element.None, Rarity.Common, 20, 2900, 80, 70, 70); // 20: Monkey -> tanzee
        _addSpecies(Element.Dark, Element.None, Rarity.Rare, 50, 2920, 75, 85, 70); // 21: NightFox -> nox
        _addSpecies(Element.Fire, Element.None, Rarity.Common, 20, 2700, 60, 70, 80); // 22: LavaGirl -> flambelle
        _addSpecies(Element.Fire, Element.None, Rarity.Common, 20, 2870, 75, 70, 75); // 23: FlameBambi -> rooby
        _addSpecies(Element.Dark, Element.None, Rarity.Common, 20, 3040, 70, 60, 70); // 24: Bastet -> mau
        _addSpecies(Element.Ice, Element.None, Rarity.Common, 20, 2750, 70, 65, 70); // 25: Bastet_Ice -> mau-cryst
        _addSpecies(Element.Ground, Element.None, Rarity.Common, 20, 2880, 80, 70, 70); // 26: Boar -> rushoar
        _addSpecies(Element.Fire, Element.None, Rarity.Common, 20, 2990, 65, 75, 70); // 27: Kitsunebi -> foxparks
        _addSpecies(Element.Dark, Element.Water, Rarity.Common, 20, 2770, 60, 60, 70); // 28: NegativeOctopus -> killamari
        _addSpecies(Element.Ground, Element.None, Rarity.Common, 20, 2790, 65, 80, 50); // 29: CuteMole -> fuddler
        _addSpecies(Element.Neutral, Element.None, Rarity.Rare, 50, 2710, 95, 80, 80); // 30: Deer -> eikthyrdeer
        _addSpecies(Element.Ground, Element.None, Rarity.Rare, 50, 2580, 95, 80, 80); // 31: Deer_Ground -> eikthyrdeer-terra
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2680, 80, 90, 75); // 32: Garm -> direhowl
        _addSpecies(Element.Grass, Element.None, Rarity.Common, 20, 2610, 100, 70, 90); // 33: BerryGoat -> caprity
        _addSpecies(Element.Ice, Element.None, Rarity.Common, 20, 2840, 60, 60, 60); // 34: MopBaby -> swee
        _addSpecies(Element.Ice, Element.None, Rarity.Rare, 50, 2150, 100, 90, 90); // 35: MopKing -> sweepa
        _addSpecies(Element.Ground, Element.None, Rarity.Common, 20, 2780, 80, 70, 70); // 36: WindChimes -> hangyu
        _addSpecies(Element.Ice, Element.None, Rarity.Common, 20, 2510, 80, 80, 70); // 37: WindChimes_Ice -> hangyu-cryst
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2820, 70, 70, 90); // 38: SweetsSheep -> woolipop
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2800, 90, 50, 80); // 39: CowPal -> mozzarina
        _addSpecies(Element.Water, Element.Dragon, Rarity.Rare, 50, 1830, 110, 100, 100); // 40: BlueDragon -> azurobe
        _addSpecies(Element.Electric, Element.None, Rarity.Common, 20, 3010, 60, 75, 70); // 41: ElecCat -> sparkit
        _addSpecies(Element.Water, Element.None, Rarity.Common, 20, 2810, 70, 70, 70); // 42: Kelpie -> kelpsea
        _addSpecies(Element.Fire, Element.None, Rarity.Common, 20, 2470, 70, 70, 70); // 43: Kelpie_Fire -> kelpsea-ignis
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2570, 75, 85, 60); // 44: Eagle -> galeclaw
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2560, 100, 95, 80); // 45: HawkBird -> nitewing
        _addSpecies(Element.Dark, Element.None, Rarity.Rare, 50, 2340, 95, 95, 80); // 46: CatBat -> tombat
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 2730, 60, 75, 70); // 47: ColorfulBird -> tocotoco
        _addSpecies(Element.Electric, Element.None, Rarity.Rare, 50, 2270, 80, 105, 105); // 48: Kirin -> univolt
        _addSpecies(Element.Water, Element.None, Rarity.Common, 20, 2550, 90, 90, 75); // 49: SharkKid -> gobfin
        _addSpecies(Element.Fire, Element.None, Rarity.Common, 20, 2430, 90, 90, 75); // 50: SharkKid_Fire -> gobfin-ignis
        _addSpecies(Element.Dark, Element.None, Rarity.Common, 20, 2110, 80, 100, 80); // 51: Werewolf -> loupmoon
        _addSpecies(Element.Dark, Element.None, Rarity.Common, 20, 2370, 75, 95, 80); // 52: DarkCrow -> cawgnito
        _addSpecies(Element.Fire, Element.None, Rarity.Common, 20, 2320, 85, 95, 95); // 53: FlameBuffalo -> arsox
        _addSpecies(Element.Grass, Element.None, Rarity.Common, 20, 2690, 80, 80, 80); // 54: LittleBriarRose -> bristla
        _addSpecies(Element.Grass, Element.None, Rarity.Common, 20, 2620, 70, 80, 80); // 55: CuteButterfly -> cinnamoth
        _addSpecies(Element.Dragon, Element.None, Rarity.Rare, 50, 2280, 110, 80, 90); // 56: FairyDragon -> elphidran
        _addSpecies(Element.Dragon, Element.Water, Rarity.Rare, 50, 1640, 115, 80, 95); // 57: FairyDragon_Water -> elphidran-aqua
        _addSpecies(Element.Fire, Element.Dark, Rarity.Rare, 50, 1650, 90, 115, 90); // 58: BirdDragon -> vanwyrm
        _addSpecies(Element.Ice, Element.Dark, Rarity.Rare, 50, 1430, 90, 120, 95); // 59: BirdDragon_Ice -> vanwyrm-cryst
        _addSpecies(Element.Dark, Element.None, Rarity.Rare, 50, 1570, 100, 105, 110); // 60: CatVampire -> felbat
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 1480, 100, 100, 120); // 61: VioletFairy -> vaelet
        _addSpecies(Element.Grass, Element.None, Rarity.Common, 20, 2350, 80, 90, 90); // 62: SoldierBee -> beegarde
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 1790, 90, 105, 100); // 63: QueenBee -> elizabee
        _addSpecies(Element.Dark, Element.None, Rarity.Rare, 50, 2090, 120, 70, 70); // 64: PinkLizard -> lovander
        _addSpecies(Element.Neutral, Element.None, Rarity.Rare, 50, 2120, 110, 80, 80); // 65: NaughtyCat -> grintale
        _addSpecies(Element.Dark, Element.None, Rarity.Common, 20, 2670, 80, 80, 50); // 66: LizardMan -> leezpunk
        _addSpecies(Element.Fire, Element.None, Rarity.Common, 20, 2640, 80, 80, 50); // 67: LizardMan_Fire -> leezpunk-ignis
        _addSpecies(Element.Neutral, Element.None, Rarity.Rare, 50, 2140, 90, 95, 90); // 68: Gorilla -> gorirat
        _addSpecies(Element.Water, Element.None, Rarity.Common, 20, 2440, 90, 90, 80); // 69: Serpent -> surfent
        _addSpecies(Element.Ground, Element.None, Rarity.Rare, 50, 1840, 90, 90, 100); // 70: Serpent_Ground -> surfent-terra
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 2260, 90, 105, 80); // 71: RobinHood -> robinquill
        _addSpecies(Element.Grass, Element.Ground, Rarity.Rare, 50, 2050, 90, 105, 80); // 72: RobinHood_Ground -> robinquill-terra
        _addSpecies(Element.Grass, Element.None, Rarity.Common, 20, 2660, 75, 65, 70); // 73: FlowerRabbit -> flopie
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 2080, 90, 110, 80); // 74: FoxMage -> wixen
        _addSpecies(Element.Dark, Element.None, Rarity.Rare, 50, 2040, 90, 105, 90); // 75: CatMage -> katress
        _addSpecies(Element.Dark, Element.None, Rarity.Rare, 50, 1130, 100, 125, 100); // 76: HadesBird -> helzephyr
        _addSpecies(Element.Neutral, Element.None, Rarity.Rare, 50, 2010, 90, 100, 90); // 77: Mutant -> lunaris
        _addSpecies(Element.Neutral, Element.None, Rarity.Common, 20, 1960, 110, 110, 90); // 78: FengyunDeeper -> fenglope
        _addSpecies(Element.Grass, Element.Dragon, Rarity.Rare, 50, 2100, 110, 85, 90); // 79: FlowerDinosaur -> dinossom
        _addSpecies(Element.Electric, Element.Dragon, Rarity.Rare, 50, 1890, 110, 90, 90); // 80: FlowerDinosaur_Electric -> dinossom-lux
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 1560, 80, 125, 80); // 81: Ronin -> bushi
        _addSpecies(Element.Grass, Element.Ground, Rarity.Rare, 50, 1340, 150, 85, 90); // 82: GrassMammoth -> mammorest
        _addSpecies(Element.Ice, Element.Ground, Rarity.Rare, 50, 1070, 150, 85, 90); // 83: GrassMammoth_Ice -> mammorest-cryst
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 1720, 100, 95, 100); // 84: FlowerDoll -> petallia
        _addSpecies(Element.Fire, Element.Dark, Rarity.Common, 20, 1470, 95, 100, 85); // 85: Baphomet -> incineram
        _addSpecies(Element.Dark, Element.None, Rarity.Rare, 50, 1310, 95, 105, 85); // 86: Baphomet_Dark -> incineram-noct
        _addSpecies(Element.Electric, Element.None, Rarity.Common, 20, 2400, 70, 80, 70); // 87: RaijinDaughter -> dazzi
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 1980, 100, 95, 90); // 88: FireKirin -> pyrin
        _addSpecies(Element.Fire, Element.Dark, Rarity.Rare, 50, 1870, 100, 95, 90); // 89: FireKirin_Dark -> pyrin-noct
        _addSpecies(Element.Dragon, Element.Water, Rarity.Rare, 50, 1090, 120, 115, 110); // 90: LazyDragon -> relaxaurus
        _addSpecies(Element.Dragon, Element.Electric, Rarity.Rare, 50, 770, 120, 120, 110); // 91: LazyDragon_Electric -> relaxaurus-lux
        _addSpecies(Element.Ice, Element.None, Rarity.Rare, 50, 1970, 90, 95, 105); // 92: IceFox -> foxcicle
        _addSpecies(Element.Electric, Element.None, Rarity.Rare, 50, 1690, 105, 115, 80); // 93: ThunderBird -> beakon
        _addSpecies(Element.Electric, Element.None, Rarity.Rare, 50, 1920, 90, 100, 80); // 94: ThunderDog -> rayhound
        _addSpecies(Element.Dark, Element.Ground, Rarity.Rare, 50, 1120, 100, 100, 130); // 95: DarkScorpion -> menasting
        _addSpecies(Element.Ice, Element.None, Rarity.Common, 20, 1930, 100, 85, 110); // 96: IceDeer -> reindrix
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 2060, 100, 90, 90); // 97: GrassPanda -> mossanda
        _addSpecies(Element.Electric, Element.None, Rarity.Rare, 50, 1440, 100, 100, 100); // 98: GrassPanda_Electric -> mossanda-lux
        _addSpecies(Element.Ice, Element.Dragon, Rarity.Common, 20, 2330, 90, 80, 80); // 99: WeaselDragon -> chillet
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 1050, 95, 105, 120); // 100: RedArmorBird -> ragnahawk
        _addSpecies(Element.Ground, Element.None, Rarity.Rare, 50, 1550, 80, 95, 120); // 101: DrillGame -> digtoise
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 1380, 120, 90, 100); // 102: SakuraSaurus -> broncherry
        _addSpecies(Element.Grass, Element.Water, Rarity.Rare, 50, 1080, 120, 95, 100); // 103: SakuraSaurus_Water -> broncherry-aqua
        _addSpecies(Element.Ground, Element.Water, Rarity.Common, 20, 2290, 100, 70, 95); // 104: LazyCatfish -> dumud
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 1670, 100, 115, 100); // 105: AmaterasuWolf -> kitsun
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 1360, 105, 110, 80); // 106: Manticore -> blazehowl
        _addSpecies(Element.Fire, Element.Dark, Rarity.Rare, 50, 1270, 105, 115, 80); // 107: Manticore_Dark -> blazehowl-noct
        _addSpecies(Element.Ground, Element.Grass, Rarity.Rare, 50, 1280, 120, 100, 120); // 108: HerculesBeetle -> warsect
        _addSpecies(Element.Ice, Element.None, Rarity.Rare, 50, 1810, 110, 90, 100); // 109: WhiteMoth -> sibelyx
        _addSpecies(Element.Dark, Element.None, Rarity.Rare, 50, 1710, 75, 105, 80); // 110: GhostBeast -> maraith
        _addSpecies(Element.Dragon, Element.Water, Rarity.Rare, 50, 590, 130, 120, 100); // 111: Umihebi -> jormuntide
        _addSpecies(Element.Dragon, Element.Fire, Rarity.Rare, 50, 170, 130, 130, 100); // 112: Umihebi_Fire -> jormuntide-ignis
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 1200, 120, 105, 105); // 113: Suzaku -> suzaku
        _addSpecies(Element.Water, Element.None, Rarity.Rare, 50, 740, 125, 105, 105); // 114: Suzaku_Water -> suzaku-aqua
        _addSpecies(Element.Dragon, Element.None, Rarity.Rare, 50, 1210, 105, 100, 100); // 115: SkyDragon -> quivern
        _addSpecies(Element.Fire, Element.Ground, Rarity.Rare, 50, 1060, 110, 105, 120); // 116: VolcanicMonster -> reptyro
        _addSpecies(Element.Ice, Element.Ground, Rarity.Rare, 50, 600, 110, 105, 130); // 117: VolcanicMonster_Ice -> reptyro-cryst
        _addSpecies(Element.Ice, Element.None, Rarity.Rare, 50, 1040, 100, 100, 110); // 118: WhiteTiger -> cryolinx
        _addSpecies(Element.Ice, Element.None, Rarity.Rare, 50, 830, 140, 80, 100); // 119: Yeti -> wumpo
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 610, 140, 80, 110); // 120: Yeti_Grass -> wumpo-botan
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 410, 100, 125, 120); // 121: KingBahamut -> blazamut
        _addSpecies(Element.Ground, Element.None, Rarity.Legendary, 80, 480, 120, 130, 100); // 122: Anubis -> anubis
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 1160, 90, 115, 90); // 123: GrassRabbitMan -> verdash
        _addSpecies(Element.Dragon, Element.Dark, Rarity.Rare, 50, 490, 100, 125, 125); // 124: BlackMetalDragon -> astegon
        _addSpecies(Element.Electric, Element.None, Rarity.Rare, 50, 1020, 120, 105, 105); // 125: ElecPanda -> grizzbolt
        _addSpecies(Element.Grass, Element.None, Rarity.Rare, 50, 240, 120, 120, 110); // 126: LilyQueen -> lyleen
        _addSpecies(Element.Dark, Element.None, Rarity.Legendary, 80, 220, 115, 120, 115); // 127: LilyQueen_Dark -> lyleen-noct
        _addSpecies(Element.Dragon, Element.Electric, Rarity.Rare, 50, 120, 120, 130, 115); // 128: ThunderDragonMan -> orserk
        _addSpecies(Element.Fire, Element.None, Rarity.Rare, 50, 500, 105, 110, 115); // 129: Horus -> faleris
        _addSpecies(Element.Dark, Element.None, Rarity.Legendary, 80, 550, 120, 120, 140); // 130: BlackGriffon -> shadowbeak
        _addSpecies(Element.Neutral, Element.None, Rarity.Legendary, 80, 180, 130, 120, 145); // 131: SaintCentaur -> paladius
        _addSpecies(Element.Dark, Element.None, Rarity.Legendary, 80, 190, 130, 145, 120); // 132: BlackCentaur -> necromus
        _addSpecies(Element.Ice, Element.None, Rarity.Legendary, 80, 150, 140, 140, 120); // 133: IceHorse -> frostallion
        _addSpecies(Element.Dark, Element.None, Rarity.Legendary, 80, 110, 140, 140, 135); // 134: IceHorse_Dark -> frostallion-noct
        _addSpecies(Element.Dragon, Element.None, Rarity.Legendary, 80, 70, 115, 140, 120); // 135: JetDragon -> jetragon

        // Dataset special recipes; keep the existing rank-average fallback and lower-ID tie break.
        _recipes[_recipeKey(90, 41)] = 92; // LazyDragon_Electric
        _recipes[_recipeKey(85, 110)] = 87; // Baphomet_Dark
        _recipes[_recipeKey(24, 13)] = 26; // Bastet_Ice
        _recipes[_recipeKey(58, 92)] = 60; // BirdDragon_Ice
        _recipes[_recipeKey(30, 36)] = 32; // Deer_Ground
        _recipes[_recipeKey(56, 69)] = 58; // FairyDragon_Water
        _recipes[_recipeKey(88, 75)] = 90; // FireKirin_Dark
        _recipes[_recipeKey(82, 119)] = 84; // GrassMammoth_Ice
        _recipes[_recipeKey(97, 125)] = 99; // GrassPanda_Electric
        _recipes[_recipeKey(79, 94)] = 81; // FlowerDinosaur_Electric
        _recipes[_recipeKey(10, 13)] = 12; // Hedgehog_Ice
        _recipes[_recipeKey(133, 76)] = 135; // IceHorse_Dark
        _recipes[_recipeKey(17, 96)] = 19; // KingAlpaca_Ice
        _recipes[_recipeKey(126, 95)] = 128; // LilyQueen_Dark
        _recipes[_recipeKey(66, 22)] = 68; // LizardMan_Fire
        _recipes[_recipeKey(106, 60)] = 108; // Manticore_Dark
        _recipes[_recipeKey(71, 29)] = 73; // RobinHood_Ground
        _recipes[_recipeKey(102, 4)] = 104; // SakuraSaurus_Water
        _recipes[_recipeKey(69, 104)] = 71; // Serpent_Ground
        _recipes[_recipeKey(49, 23)] = 51; // SharkKid_Fire
        _recipes[_recipeKey(113, 111)] = 115; // Suzaku_Water
        _recipes[_recipeKey(116, 92)] = 118; // VolcanicMonster_Ice
        _recipes[_recipeKey(36, 34)] = 38; // WindChimes_Ice
        _recipes[_recipeKey(97, 84)] = 127; // LilyQueen
        _recipes[_recipeKey(58, 122)] = 130; // Horus
        _recipes[_recipeKey(97, 94)] = 126; // ElecPanda
        _recipes[_recipeKey(125, 90)] = 129; // ThunderDragonMan
        _recipes[_recipeKey(105, 124)] = 131; // BlackGriffon
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
        uint16 breedRank,
        uint16 maxHP,
        uint16 atk,
        uint16 def
    ) private {
        _speciesByRarity[rarity].push(uint8(_species.length));
        _species.push(Species(element, secondElement, rarity, basePower, breedRank, maxHP, atk, def));
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
                    0,
                    species.maxHP,
                    species.atk,
                    species.def
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
