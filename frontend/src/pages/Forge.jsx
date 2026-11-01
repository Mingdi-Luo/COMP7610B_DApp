import WalletGate from "../components/WalletGate.jsx";

/**
 * TODO(frontend B): the merge workshop.
 * - List the player's cards with useMyCards() and make them selectable (<Card onClick selected />).
 * - After the first pick, disable cards of other rarities; allow exactly three; no Legendary.
 * - Preview "You will get one <next rarity> card".
 * - Send getCardsContract(await getSigner()).merge([id1, id2, id3]) through useTx(),
 *   read the CardsMerged event from the receipt (see Shop.jsx), show the new card, refresh().
 */
export default function Forge() {
  return (
    <section className="panel">
      <h1>Forge</h1>
      <p className="lead">Burn three cards of the same rarity to mint one card of the next rarity.</p>
      <WalletGate>
        <p className="notice">Coming soon.</p>
      </WalletGate>
    </section>
  );
}
