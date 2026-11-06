import { useState } from "react";
import Card from "../components/Card.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { ELEMENTS, RARITIES } from "../config/contracts.js";
import { useMyCards } from "../hooks/useMyCards.js";

const SORTS = {
  newest: { label: "Newest", compare: (a, b) => b.tokenId - a.tokenId },
  strongest: { label: "Highest ATK", compare: (a, b) => b.atk - a.atk },
  weakest: { label: "Lowest ATK", compare: (a, b) => a.atk - b.atk },
};

export default function Collection({ onNavigate }) {
  return (
    <section className="panel">
      <h1>My cards</h1>
      <p className="lead">Every card you own on-chain. You can also see them in any NFT wallet.</p>
      <WalletGate>
        <CardList onNavigate={onNavigate} />
      </WalletGate>
    </section>
  );
}

function CardList({ onNavigate }) {
  const { cards, loading, error, refresh } = useMyCards();
  // "all" or an enum number as a string, as <select> values are strings.
  const [rarity, setRarity] = useState("all");
  const [element, setElement] = useState("all");
  const [sort, setSort] = useState("newest");

  const shown = cards
    .filter((card) => rarity === "all" || card.rarity === Number(rarity))
    .filter((card) => element === "all" || card.element === Number(element) || card.secondElement === Number(element))
    .sort(SORTS[sort].compare);
  const counts = RARITIES.map((_, index) => cards.filter((card) => card.rarity === index).length);
  // Legendary cards (the last rarity) cannot be merged.
  const canMerge = counts.slice(0, -1).some((count) => count >= 3);

  if (cards.length === 0) {
    return (
      <>
        {error && <p className="notice notice-error">{error}</p>}
        {loading ? (
          <p className="muted">Loading your cards...</p>
        ) : (
          <div className="notice">
            <p>No cards yet.</p>
            <button type="button" onClick={() => onNavigate("shop")}>Go to the shop</button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <p className="collection-summary">
        <strong>{cards.length} cards</strong>
        {RARITIES.map((name, index) => (
          <span key={name} className={`rarity-${name.toLowerCase()} rarity-count`}>{counts[index]} {name}</span>
        ))}
      </p>
      {canMerge && (
        <div className="notice">
          <p>You have three cards of the same rarity. Merge them into a rarer card.</p>
          <button type="button" onClick={() => onNavigate("forge")}>Go to the Forge</button>
        </div>
      )}

      <div className="toolbar">
        <label className="field">
          <span>Rarity</span>
          <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
            <option value="all">All</option>
            {RARITIES.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Element</span>
          <select value={element} onChange={(event) => setElement(event.target.value)}>
            <option value="all">All</option>
            {ELEMENTS.slice(0, 9).map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {Object.entries(SORTS).map(([id, { label }]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="button-secondary" onClick={refresh} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      {error && <p className="notice notice-error">{error}</p>}

      {shown.length > 0 ? (
        <div className="card-grid">
          {shown.map((card) => <Card key={card.tokenId} {...card} />)}
        </div>
      ) : (
        <p className="muted">No cards match these filters.</p>
      )}
    </>
  );
}
