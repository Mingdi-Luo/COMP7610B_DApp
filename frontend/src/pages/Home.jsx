// TODO(frontend A): polish the landing page, e.g. an element-triangle graphic.
export default function Home({ onNavigate }) {
  return (
    <section className="panel">
      <span className="eyebrow">On-chain card game</span>
      <h1>Elemental Duel</h1>
      <p className="lead">
        Open packs to mint elemental card NFTs, merge duplicates into rarer cards, and stake ETH in
        duels where neither player can peek at the other&apos;s card.
      </p>

      <ol className="steps">
        <li><strong>Collect.</strong> Each pack mints one card. The drop rates live in the contract, so anyone can audit them.</li>
        <li><strong>Merge.</strong> Burn three cards of one rarity to mint a card of the next rarity.</li>
        <li><strong>Duel.</strong> Commit a hidden card, reveal it, and the stronger card takes the pot.</li>
      </ol>

      <p className="triangle">🔥 Fire beats 🌿 Wood · 🌿 Wood beats 💧 Water · 💧 Water beats 🔥 Fire</p>

      <button type="button" onClick={() => onNavigate("shop")}>Open your first pack</button>
    </section>
  );
}
