import { useMemo, useState } from "react";
import Card, { CardReveal } from "../components/Card.jsx";
import TxStatus from "../components/TxStatus.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { RARITIES, getCardsContract } from "../config/contracts.js";
import { useMyCards } from "../hooks/useMyCards.js";
import { useTx } from "../hooks/useTx.js";
import { useWallet } from "../hooks/useWallet.jsx";
import { findEvent, toCard } from "../lib/cards.js";

const LEGENDARY = 2;
const MERGE_SIZE = 3;

export default function Forge({ onNavigate }) {
  return (
    <section className="panel">
      <h1>Forge</h1>
      <p className="lead">
        Burn three cards of the same rarity to mint one card of the next rarity, with a fresh random
        element and power. Legendary cards are already at the top.
      </p>
      <WalletGate>
        <Workshop onNavigate={onNavigate} />
      </WalletGate>
    </section>
  );
}

function Workshop({ onNavigate }) {
  const { getProvider, getSigner } = useWallet();
  const { cards, loading, error, refresh } = useMyCards();
  const tx = useTx();
  const [selectedIds, setSelectedIds] = useState([]);
  const [forging, setForging] = useState(false);
  const [forged, setForged] = useState(null);

  // Weakest first within each rarity, so the obvious merge material comes first.
  const sorted = useMemo(() => [...cards].sort((a, b) => a.rarity - b.rarity || a.power - b.power), [cards]);
  // Ignore selected IDs that left the collection (merged, or another account).
  const selected = selectedIds.map((id) => cards.find((card) => card.tokenId === id)).filter(Boolean);
  const rarity = selected[0]?.rarity;
  const ready = selected.length === MERGE_SIZE;

  function canSelect(card) {
    if (card.rarity === LEGENDARY) return false;
    return selected.length === 0 || (selected.length < MERGE_SIZE && card.rarity === rarity);
  }

  function toggle(card) {
    setForged(null);
    const ids = selected.map((picked) => picked.tokenId);
    setSelectedIds(ids.includes(card.tokenId) ? ids.filter((id) => id !== card.tokenId) : [...ids, card.tokenId]);
  }

  function selectWeakest(rarityToMerge) {
    setForged(null);
    setSelectedIds(sorted.filter((card) => card.rarity === rarityToMerge).slice(0, MERGE_SIZE).map((card) => card.tokenId));
  }

  async function merge() {
    setForged(null);
    setForging(true);
    try {
      const tokenIds = selected.map((card) => card.tokenId);
      let contract;
      const receipt = await tx.run(
        async () => {
          contract = getCardsContract(await getSigner());
          return contract.merge(tokenIds);
        },
        { pending: "Forging your cards...", success: "Merge complete!" },
      );
      if (!receipt) return;

      setSelectedIds([]);
      // CardsMerged names the new card; its attributes come from getCard.
      const event = findEvent(receipt, contract, "CardsMerged");
      if (event) {
        const { newTokenId } = event.args;
        setForged(toCard(newTokenId, await getCardsContract(getProvider()).getCard(newTokenId)));
      }
      refresh();
    } catch {
      // The merge itself succeeded; the collection below still refreshes.
      refresh();
    } finally {
      setForging(false);
    }
  }

  let hint = "Pick three cards of the same rarity.";
  if (ready) hint = `Ready: three ${RARITIES[rarity]} cards become one ${RARITIES[rarity + 1]} card.`;
  else if (selected.length > 0) hint = `Pick ${MERGE_SIZE - selected.length} more ${RARITIES[rarity]} card${MERGE_SIZE - selected.length > 1 ? "s" : ""}.`;

  return (
    <>
      <div className="forge-bench">
        <div className="forge-inputs">
          {Array.from({ length: MERGE_SIZE }, (_, slot) =>
            selected[slot] ? (
              <div key={selected[slot].tokenId} className="card-slot">
                <Card {...selected[slot]} selected onClick={() => toggle(selected[slot])} />
              </div>
            ) : (
              <div key={`empty-${slot}`} className="card-slot">
                <div className="empty-slot">Card {slot + 1}</div>
              </div>
            ),
          )}
        </div>
        <span className="forge-arrow" aria-hidden="true">→</span>
        <div className="card-slot">
          {forging || forged ? (
            <CardReveal card={forged} shaking={forging} />
          ) : (
            <div className="empty-slot">{ready ? `1 ${RARITIES[rarity + 1]}` : "?"}</div>
          )}
        </div>
      </div>

      <p className="muted">{hint}</p>
      <button type="button" onClick={merge} disabled={!ready || tx.busy}>
        {tx.busy ? "Forging..." : "Merge 3 cards"}
      </button>
      <TxStatus tx={tx} />

      <h2>Your cards</h2>
      <div className="toolbar">
        {[0, 1].map((rarityToMerge) => {
          const count = cards.filter((card) => card.rarity === rarityToMerge).length;
          return (
            <button
              key={rarityToMerge}
              type="button"
              className="button-secondary"
              onClick={() => selectWeakest(rarityToMerge)}
              disabled={count < MERGE_SIZE || tx.busy}
            >
              Pick 3 weakest {RARITIES[rarityToMerge]} ({count})
            </button>
          );
        })}
        <button type="button" className="button-secondary" onClick={refresh} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      {error && <p className="notice notice-error">{error}</p>}

      {sorted.length > 0 ? (
        <div className="card-grid">
          {sorted.map((card) => {
            const isSelected = selected.includes(card);
            return (
              <Card
                key={card.tokenId}
                {...card}
                selected={isSelected}
                disabled={tx.busy || (!isSelected && !canSelect(card))}
                onClick={() => toggle(card)}
              />
            );
          })}
        </div>
      ) : (
        !loading && (
          <div className="notice">
            <p>You have no cards to merge yet.</p>
            <button type="button" onClick={() => onNavigate("shop")}>Go to the shop</button>
          </div>
        )
      )}
    </>
  );
}
