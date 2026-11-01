import { useState } from "react";
import Card from "../components/Card.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { useMyCards } from "../hooks/useMyCards.js";
import { SAMPLE_CARDS } from "../mock/cards.js";

// TODO(frontend A): filter by rarity and element, sort by power, show counts per rarity.
export default function Collection({ onNavigate }) {
  const { cards, loading, error, refresh } = useMyCards();
  const [showSamples, setShowSamples] = useState(false);

  return (
    <section className="panel">
      <h1>My cards</h1>
      <p className="lead">Every card you own on-chain. You can also see them in any NFT wallet.</p>

      <WalletGate>
        <div className="toolbar">
          <button type="button" className="button-secondary" onClick={refresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {error && <p className="notice notice-error">{error}</p>}

        {cards.length > 0 ? (
          <div className="card-grid">
            {cards.map((card) => <Card key={card.tokenId} {...card} />)}
          </div>
        ) : (
          !loading && (
            <div className="notice">
              <p>No cards yet.</p>
              <button type="button" onClick={() => onNavigate("shop")}>Go to the shop</button>
            </div>
          )
        )}
      </WalletGate>

      {/* Sample data lets the UI be styled before the contracts can mint. Remove before the demo. */}
      <button type="button" className="button-link" onClick={() => setShowSamples((shown) => !shown)}>
        {showSamples ? "Hide" : "Preview"} sample cards
      </button>
      {showSamples && (
        <div className="card-grid">
          {SAMPLE_CARDS.map((card) => <Card key={card.tokenId} {...card} />)}
        </div>
      )}
    </section>
  );
}
