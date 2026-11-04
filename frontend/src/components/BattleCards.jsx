import { SPECIES } from "../config/species.js";
import { resultOf, sideOf } from "../lib/battles.js";
import { battleBreakdown } from "../lib/cards.js";
import { formatSignedCoins, shortAddress } from "../lib/format.js";
import Card, { CardBack } from "./Card.jsx";

const OUTCOME_LABELS = { won: "Won", lost: "Lost", draw: "Draw" };

/**
 * Two cards side by side; a null card shows face down. With showPower each card also
 * shows how its battle power was worked out from the element chart and its passive.
 */
export function Matchup({ left, right, leftLabel = "You", rightLabel = "Opponent", leftNote, rightNote, showPower = false }) {
  return (
    <div className="duel">
      <Fighter label={leftLabel} card={left} enemy={right} note={leftNote} showPower={showPower} />
      <span className="duel-vs" aria-hidden="true">VS</span>
      <Fighter label={rightLabel} card={right} enemy={left} note={rightNote} showPower={showPower} />
    </div>
  );
}

function Fighter({ label, card, enemy, note, showPower }) {
  return (
    <div className="fighter">
      <span className="muted">{label}</span>
      <div className="card-slot">{card ? <Card {...card} /> : <CardBack />}</div>
      {showPower && card && enemy ? <PowerLine card={card} enemy={enemy} /> : note && <p className="fighter-note">{note}</p>}
    </div>
  );
}

function PowerLine({ card, enemy }) {
  const { multiplier, bonus, total } = battleBreakdown(card, enemy);
  if (multiplier === 100 && bonus === 0) {
    return <p className="fighter-power">Power <strong>{total}</strong></p>;
  }
  return (
    <p className="fighter-power">
      {card.power}
      {multiplier !== 100 && ` × ${multiplier / 100}`}
      {bonus > 0 && ` × ${(100 + bonus) / 100}`} = <strong>{total}</strong>
    </p>
  );
}

/** "Won", "Lost" or "Draw", with the coins gained or lost for a staked battle. */
export function OutcomeBadge({ battle, account }) {
  const { outcome, net } = resultOf(battle, account);
  return (
    <span className={`badge badge-${outcome}`}>
      {OUTCOME_LABELS[outcome]}
      {battle.stake > 0n && ` ${formatSignedCoins(net)}`}
    </span>
  );
}

/** One line per finished battle, for short "recent results" lists. */
export function ResultRow({ battle, account }) {
  const { myCard, theirCard, rival } = sideOf(battle, account);
  const cardName = (card) => (card ? `${SPECIES[card.speciesId].name} (${card.power})` : "no reveal");
  return (
    <div className="battle-row">
      <div>
        <strong>Battle #{battle.id}</strong>
        <span className="muted"> vs {shortAddress(rival)} · {cardName(myCard)} vs {cardName(theirCard)}</span>
      </div>
      <OutcomeBadge battle={battle} account={account} />
    </div>
  );
}
