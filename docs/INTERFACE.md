# Contract interface

Enums are passed as numbers in JavaScript, in the order listed here (see
`frontend/src/config/contracts.js`). After changing a signature, event or error, run
`npm run export-abi` in `contracts/`.

## GameCoin (ERC-20 + Ownable)

Name `Duel Coin`, symbol `DUEL`, 0 decimals. 1 ETH buys 1,000,000 coins, so one coin costs
`WEI_PER_COIN` = 10^12 wei. Top-ups are one-way: decomposing cards mints coins, so the supply is not
fully backed by ETH and coins cannot be redeemed.

| Function | Kind | Description |
| --- | --- | --- |
| `topUp() returns (uint256 coins)` | payable | `msg.value` must be a non-zero whole number of coins. |
| `setGameContract(address game, bool allowed)` | owner only | Lets a contract call `spend`, `reward` and `collect`. |
| `spend(address from, uint256 amount)` | game only | Burns a player's coins. |
| `reward(address to, uint256 amount)` | game only | Mints coins to a player. |
| `collect(address from, address to, uint256 amount)` | game only | Moves a player's coins, such as a stake into the Arena. |
| `withdraw()` | owner only | Sends all top-up ETH to the owner. |
| `isGameContract(address) returns (bool)` | view | Whether a contract is approved. |

Standard ERC-20 functions (`balanceOf`, `transfer`, ...) are inherited.

```solidity
event ToppedUp(address indexed player, uint256 weiPaid, uint256 coins);
event GameContractSet(address indexed game, bool allowed);
```

Errors: `InvalidTopUp(sent)`, `NotGameContract(caller)`, `WithdrawFailed()`, plus OpenZeppelin's
`ERC20InsufficientBalance(sender, balance, needed)`, which reaches players when a game action costs
more coins than they have.

## ElementCards (ERC-721 + ERC721Enumerable)

Collection name `Elemental Duel Card`, symbol `EDC`. Token IDs start at 1. Constructor:
`ElementCards(address coinAddress)`.

### Types

```solidity
enum Element { Neutral, Fire, Water, Grass, Electric, Ground, Ice, Dragon, Dark }  // 0..8
enum Rarity  { Common, Rare, Legendary }                                           // 0, 1, 2
enum Passive { None, Pierce, Underdog, Resonance, Guard, Focus }                   // 0..5
enum Gender  { Male, Female }                                                      // 0, 1

// secondElement equals element for a single-element species.
struct Species { Element element; Element secondElement; Rarity rarity; uint8 basePower; uint16 breedRank; }
struct Card {
    uint8 speciesId;
    Element element;
    Element secondElement;
    Rarity rarity;
    uint8 power;           // basePower plus 0 to POWER_SPREAD - 1
    Passive passive;
    Gender gender;         // rolled at random when the card is minted
    uint8 generation;      // 0 for packs and merges; breeding gives max(parents) + 1
    uint64 breedReadyAt;   // unix seconds; 0 if the card has never bred
}
```

### Rules

| Rarity | Drop rate | Power | Decompose value | Enchant cost | Breed fee (by child) |
| --- | --- | --- | --- | --- | --- |
| Common | 70% (7000 bp) | 10–39 | 300 | 200 | 500 |
| Rare | 25% (2500 bp) | 40–69 | 900 | 500 | 1,500 |
| Legendary | 5% (500 bp) | 70–100 | 2,700 | 1,000 | 4,500 |

Prices are in coins. A pack costs 1,000 coins. Merging is free.

The prices rule out free coins. Each decompose value is three times the one below, so merging and
then decomposing gains nothing. Each breed fee is above the child's decompose value, so breeding
and then decomposing loses coins even though the parents are kept.

**Breeding:** the parents must be one male and one female, in either order. A special recipe wins
if one exists. Otherwise the child is the species whose
`breedRank` is closest to the average of the parents' ranks, with ties going to the lower species
ID. After breeding, a parent rests for `BREED_COOLDOWN * (generation + 1)`. Recipes, by species ID:
4 + 7 → 5, 13 + 16 → 14, 19 + 22 → 20.

A merged card has a random species of the next rarity. New cards from packs, merges and breeding
have no passive.

### Functions

| Function | Kind | Description |
| --- | --- | --- |
| `openPack() returns (uint256 tokenId)` | | Spends `PACK_PRICE` coins; mints one random card to the caller. |
| `merge(uint256[3] tokenIds) returns (uint256 newTokenId)` | | Burns three distinct, same-rarity, non-Legendary cards owned by the caller; mints one card of the next rarity. |
| `decompose(uint256 tokenId) returns (uint256 coins)` | | Burns a card the caller owns; pays `decomposeValue` coins. |
| `enchant(uint256 tokenId) returns (Passive passive)` | | Spends `enchantCost` coins; sets one random passive, replacing the old one. |
| `breed(uint256 parentA, uint256 parentB) returns (uint256 childId)` | | Needs a rested male and a rested female card owned by the caller; spends the fee for the child's rarity and mints the child. |
| `breedResult(uint256 speciesA, uint256 speciesB) returns (uint8)` | view | The child species of two parent species. |
| `getCard(uint256 tokenId) returns (Card)` | view | Reverts with `ERC721NonexistentToken` for unknown or burned IDs. |
| `cardsOf(address owner) returns (uint256[])` | view | All token IDs owned by `owner`. |
| `getSpecies(uint256 speciesId) returns (Species)` | view | Reverts with `UnknownSpecies` for unknown IDs. |
| `speciesCount() returns (uint256)` | view | 27. |
| `dropRate(Rarity) returns (uint16)` | pure | Drop rate in basis points. |
| `powerRange(Rarity) returns (uint8 min, uint8 max)` | pure | Inclusive power range. |
| `decomposeValue(Rarity)`, `enchantCost(Rarity)`, `breedFee(Rarity)` | pure | Prices in coins. |
| `coin() returns (address)` | view | The GameCoin contract. |

Constants: `PACK_PRICE`, `COMMON_RATE_BP`, `RARE_RATE_BP`, `LEGENDARY_RATE_BP`, `POWER_SPREAD`,
`BREED_COOLDOWN`. Standard ERC-721 functions (`ownerOf`, `balanceOf`, `transferFrom`, ...) are
inherited.

### Events

```solidity
event PackOpened(address indexed player, uint256 indexed tokenId, uint8 speciesId, Rarity rarity, uint8 power);
event CardsMerged(address indexed player, uint256[3] burnedTokenIds, uint256 indexed newTokenId);
event CardDecomposed(address indexed player, uint256 indexed tokenId, uint256 coins);
event CardEnchanted(address indexed player, uint256 indexed tokenId, Passive passive);
event CardBred(address indexed player, uint256 parentA, uint256 parentB, uint256 indexed childId, uint8 speciesId);
```

### Errors

`NotCardOwner(tokenId)`, `DuplicateCard(tokenId)`, `RarityMismatch()`, `CannotMergeLegendary()`,
`UnknownSpecies(speciesId)`, `BreedOnCooldown(tokenId, readyAt)`, `SameGender()`, plus the standard OpenZeppelin
ERC-721 errors such as `ERC721NonexistentToken(tokenId)`.

## Arena (ReentrancyGuard)

Constructor: `Arena(address cardsAddress)`. It finds the coin through `cards.coin()`. Battle IDs
start at 1. Stakes are in coins.

### Types

```solidity
enum Status { None, Open, Joined, Resolved, Cancelled }   // 0..4
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
    uint64 revealDeadline;     // unix seconds; set when the opponent joins
    Status status;
    address winner;            // address(0) after resolution means a draw
}
```

### Commitment

```text
commitment = keccak256(abi.encodePacked(uint256 tokenId, bytes32 salt, address player))
```

In the browser: `computeCommitment` in `frontend/src/lib/commitment.js`, which matches
`Arena.computeCommitment`. Compute it locally and keep the salt in `localStorage` until the
reveal. Calling the contract's `computeCommitment` would send the salt to an RPC node.

### Battle flow

```text
createBattle ──► Open ──joinBattle──► Joined ──both reveal──► Resolved
                  │                      │
            cancelBattle            claimTimeout (after revealDeadline)
                  ▼                      ▼
              Cancelled              Resolved
```

The higher battle power wins `2 * stake`; a tie refunds both stakes. After the deadline, if exactly
one player has revealed, that player wins `2 * stake`; if nobody revealed, both are refunded.

A card's attributes are copied when it is revealed, so burning, transferring or enchanting a
revealed card does not change or block the result.

### Battle power

```text
battle power = power * attack multiplier * (100% + passive bonus), rounded down
```

The attack multiplier uses the attacker's first element against each of the defender's elements,
multiplied together:

| Attacker | Strong against (200%) |
| --- | --- |
| Water | Fire |
| Fire | Grass, Ice |
| Grass | Ground |
| Ground | Electric |
| Electric | Water |
| Ice | Dragon |
| Dragon | Dark |
| Dark | Neutral |

An attack is resisted (50%) when the defender is strong against the attacker. An element attacks
itself at 100%. Neutral always attacks at 100%, including against Dark.

| Passive | Effect |
| --- | --- |
| Pierce | A resisted attack still deals 100%. |
| Underdog | +30% if the card's power is below the enemy's. |
| Resonance | +20% if the two cards share an element. |
| Guard | +25% if the enemy is strong against this card. |
| Focus | +10% always. |

### Functions

| Function | Kind | Description |
| --- | --- | --- |
| `createBattle(bytes32 commitment, uint256 stake) returns (uint256 battleId)` | | Takes `stake` coins from the caller; 0 makes a friendly match. |
| `joinBattle(uint256 battleId, bytes32 commitment)` | | Needs `Open` and a caller other than the creator. Takes the same stake and starts the `REVEAL_WINDOW`. |
| `reveal(uint256 battleId, uint256 tokenId, bytes32 salt)` | | Needs `Joined`, the window still open, a matching commitment, and the caller still owning the card. The second reveal resolves the battle. |
| `claimTimeout(uint256 battleId)` | | After `revealDeadline`, settles a `Joined` battle as described above. Anyone may call it; the coins only go to the players. |
| `cancelBattle(uint256 battleId)` | | The creator refunds an `Open` battle. |
| `getBattle(uint256 battleId) returns (Battle)` | view | Reverts with `BattleNotFound` for unknown IDs. |
| `battleCount() returns (uint256)` | view | The latest battle ID; iterate `1..battleCount` to list battles. |
| `battlesOf(address player) returns (uint256[])` | view | IDs of every battle the player created or joined, oldest first. |
| `getRevealedCards(uint256 battleId) returns (Card creatorCard, Card opponentCard)` | view | Both cards as they were when revealed; a side that has not revealed comes back zeroed. Reverts with `BattleNotFound` for unknown IDs. |
| `computeCommitment(uint256, bytes32, address) returns (bytes32)` | pure | Reference implementation of the commitment. |
| `beats(Element attacker, Element defender) returns (bool)` | pure | The element chart. |
| `elementMultiplier(Element attacker, Element defender) returns (uint256)` | pure | 200, 100 or 50. |
| `attackMultiplier(Card attacker, Card defender) returns (uint256)` | pure | Percent, including a dual-element defender. |
| `battlePower(Card card, Card enemy) returns (uint256)` | pure | Battle power after the multiplier and passive. |
| `REVEAL_WINDOW() returns (uint256)` | constant | 600 seconds. |
| `cards() returns (address)`, `coin() returns (address)` | view | The ElementCards and GameCoin contracts. |

### Events

```solidity
event BattleCreated(uint256 indexed battleId, address indexed creator, uint256 stake);
event BattleJoined(uint256 indexed battleId, address indexed opponent, uint64 revealDeadline);
event CardRevealed(uint256 indexed battleId, address indexed player, uint256 tokenId);
event BattleResolved(uint256 indexed battleId, address indexed winner, uint256 payout);
event BattleCancelled(uint256 indexed battleId);
```

In `BattleResolved`, `payout` is the coins sent to the winner (`2 * stake`). For a draw, `winner` is
`address(0)` and `payout` is the stake refunded to each player.

### Errors

`BattleNotFound(battleId)`, `InvalidStatus(current)`, `CannotJoinOwnBattle()`, `NotPlayer()`,
`NotCreator()`, `AlreadyRevealed()`, `CommitmentMismatch()`, `NotCardOwner(tokenId)`,
`RevealWindowClosed()`, `RevealWindowOpen()`. `frontend/src/lib/errors.js` turns each into a
readable message.

## Security notes for the report

- **Randomness:** `block.prevrandao` can be influenced by validators, and a contract calling
  `openPack` or `enchant` could revert when it dislikes the result. Acceptable for a demo;
  Chainlink VRF is the production answer.
- **Front-running:** transactions sit in a public mempool, so cards are hidden behind
  commitments that include the player's address (a copied commitment cannot be reused).
- **Reentrancy:** state changes happen before coin transfers (checks-effects-interactions), and
  battle functions use `nonReentrant`.
- **Griefing:** a player who sees they will lose may refuse to reveal; the reveal window plus
  `claimTimeout` makes that a guaranteed loss.
- **Revealed cards:** attributes are copied at reveal time, so a player cannot block the other
  player's reveal by burning or transferring their own revealed card.
- **Payouts:** battles pay in an ERC-20 coin, and a token transfer cannot be refused the way a
  contract can refuse ETH, so a player cannot block a payout by rejecting it.
- **Trusted game contracts:** an approved game contract can move any player's coins without an
  ERC-20 approval. This saves a MetaMask step per action, but the owner must only approve the
  audited game contracts. A production game would lock this list after deployment.
- **Coin economy:** coins cannot be redeemed for ETH, which also means players should treat a
  top-up as spent. On Sepolia the ETH has no real value.
