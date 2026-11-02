# Contract interface

Frozen on 2026-11-02 so the contract and frontend teams can work in parallel. Changing a
signature, event or error below needs agreement from both teams, followed by
`npm run export-abi` in `contracts/`.

Enums are passed as numbers in JavaScript, in the order listed here (see
`frontend/src/config/contracts.js`).

## ElementCards (ERC-721 + ERC721Enumerable + Ownable)

Collection name `Elemental Duel Card`, symbol `EDC`. Token IDs start at 1.

### Types

```solidity
enum Element { Fire, Water, Wood }          // 0, 1, 2
enum Rarity  { Common, Rare, Legendary }    // 0, 1, 2
struct Card { Element element; Rarity rarity; uint8 power; }
```

### Rules

| Rarity | Drop rate | Power |
| --- | --- | --- |
| Common | 70% (7000 bp) | 10–39 |
| Rare | 25% (2500 bp) | 40–69 |
| Legendary | 5% (500 bp) | 70–100 |

A merged card gets a fresh random element and a random power inside its new rarity's range.

### Functions

| Function | Kind | Description |
| --- | --- | --- |
| `openPack() returns (uint256 tokenId)` | payable | Requires `msg.value == PACK_PRICE`. Mints one random card to the caller. |
| `merge(uint256[3] tokenIds) returns (uint256 newTokenId)` | | Burns three distinct, same-rarity, non-Legendary cards owned by the caller; mints one card of the next rarity. |
| `getCard(uint256 tokenId) returns (Card)` | view | Reverts with `ERC721NonexistentToken` for unknown or burned IDs. |
| `cardsOf(address owner) returns (uint256[])` | view | All token IDs owned by `owner`. |
| `dropRate(Rarity) returns (uint16)` | pure | Drop rate in basis points. |
| `powerRange(Rarity) returns (uint8 min, uint8 max)` | pure | Inclusive power range. |
| `PACK_PRICE() returns (uint256)` | constant | 0.001 ETH (`1e15` wei). |
| `withdraw()` | owner only | Sends all pack revenue to the owner. |

Standard ERC-721 functions (`ownerOf`, `balanceOf`, `transferFrom`, ...) are inherited.

### Events

```solidity
event PackOpened(address indexed player, uint256 indexed tokenId, Element element, Rarity rarity, uint8 power);
event CardsMerged(address indexed player, uint256[3] burnedTokenIds, uint256 indexed newTokenId);
```

### Errors

`WrongPayment(sent, required)`, `NotCardOwner(tokenId)`, `DuplicateCard(tokenId)`,
`RarityMismatch()`, `CannotMergeLegendary()`, `WithdrawFailed()`, plus the standard
OpenZeppelin ERC-721 errors such as `ERC721NonexistentToken(tokenId)`.

## Arena (ReentrancyGuard)

Constructor: `Arena(address cardsAddress)`. Battle IDs start at 1.

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

Resolution: a card with the element advantage counts at `power * 3 / 2` (rounded down). The
higher value wins `2 * stake`; a tie refunds both stakes. After the deadline, if exactly one
player has revealed, that player wins `2 * stake`; if nobody revealed, both are refunded.

A card's element and power are copied when it is revealed, so burning or transferring a
revealed card does not change or block the result.

### Functions

| Function | Kind | Description |
| --- | --- | --- |
| `createBattle(bytes32 commitment) returns (uint256 battleId)` | payable | `msg.value` is the stake; 0 makes a friendly match. |
| `joinBattle(uint256 battleId, bytes32 commitment)` | payable | Needs `Open`, a caller other than the creator, and `msg.value == stake`. Starts the `REVEAL_WINDOW`. |
| `reveal(uint256 battleId, uint256 tokenId, bytes32 salt)` | | Needs `Joined`, the window still open, a matching commitment, and the caller still owning the card. The second reveal resolves the battle. |
| `claimTimeout(uint256 battleId)` | | After `revealDeadline`, settles a `Joined` battle as described above. Anyone may call it; the money only goes to the players. |
| `cancelBattle(uint256 battleId)` | | The creator refunds an `Open` battle. |
| `getBattle(uint256 battleId) returns (Battle)` | view | Reverts with `BattleNotFound` for unknown IDs. |
| `battlesOf(address player) returns (uint256[])` | view | IDs of every battle the player created or joined, oldest first. |
| `getRevealedCards(uint256 battleId) returns (Card creatorCard, Card opponentCard)` | view | Both cards as they were when revealed; a side that has not revealed comes back zeroed. Reverts with `BattleNotFound` for unknown IDs. |
| `battleCount() returns (uint256)` | view | The latest battle ID; iterate `1..battleCount` to list battles. |
| `computeCommitment(uint256, bytes32, address) returns (bytes32)` | pure | Reference implementation of the commitment. |
| `beats(Element attacker, Element defender) returns (bool)` | pure | The element triangle. |
| `REVEAL_WINDOW() returns (uint256)` | constant | 600 seconds. |
| `cards() returns (address)` | view | The ElementCards contract. |

### Events

```solidity
event BattleCreated(uint256 indexed battleId, address indexed creator, uint256 stake);
event BattleJoined(uint256 indexed battleId, address indexed opponent, uint64 revealDeadline);
event CardRevealed(uint256 indexed battleId, address indexed player, uint256 tokenId);
event BattleResolved(uint256 indexed battleId, address indexed winner, uint256 payout);
event BattleCancelled(uint256 indexed battleId);
```

In `BattleResolved`, `payout` is the amount sent to the winner (`2 * stake`). For a draw,
`winner` is `address(0)` and `payout` is the stake refunded to each player.

### Errors

`BattleNotFound(battleId)`, `InvalidStatus(current)`, `StakeMismatch(sent, required)`,
`CannotJoinOwnBattle()`, `NotPlayer()`, `NotCreator()`, `AlreadyRevealed()`,
`CommitmentMismatch()`, `NotCardOwner(tokenId)`, `RevealWindowClosed()`,
`RevealWindowOpen()` and `TransferFailed()`. `frontend/src/lib/errors.js` turns each into a
readable message.

## Security notes for the report

- **Randomness:** `block.prevrandao` can be influenced by validators. Acceptable for a demo;
  Chainlink VRF is the production answer.
- **Front-running:** transactions sit in a public mempool, so cards are hidden behind
  commitments that include the player's address (a copied commitment cannot be reused).
- **Reentrancy:** state changes happen before ETH transfers (checks-effects-interactions),
  and payout functions use `nonReentrant`.
- **Griefing:** a player who sees they will lose may refuse to reveal; the reveal window plus
  `claimTimeout` makes that a guaranteed loss.
- **Revealed cards:** element and power are copied at reveal time, so a player cannot block the
  other player's reveal by burning or transferring their own revealed card.
- **Push payments:** winnings are sent directly to the players. A player that is a contract
  rejecting ETH could stop a draw from paying out; a pull-payment (`withdraw`) pattern would
  remove that edge case. All players in this DApp are MetaMask accounts, so we kept the simpler
  design.
