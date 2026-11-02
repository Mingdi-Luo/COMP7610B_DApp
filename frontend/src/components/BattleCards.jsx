import { battlePower, beats } from "../lib/cards.js";
import { resultOf, sideOf } from "../lib/battles.js";
import { formatSignedEth, shortAddress } from "../lib/format.js";
import Card, { CardBack } from "./Card.jsx";

const OUTCOME_LABELS = { won: "Won", lost: "Lost", draw: "Draw" };

/**
 * Two cards side by side; a null card shows face down. With showPower each
 * card also shows its battle power, including the 1.5x element advantage.
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
      {showPower && card && enemy ? (
        <p className="fighter-power">
          {beats(card.element, enemy.element) ? <>{card.power} × 1.5 = </> : "Power "}
          <strong>{battlePower(card, enemy)}</strong>
        </p>
      ) : (
        note && <p className="fighter-note">{note}</p>
      )}
    </div>
  );
}

/** "Won", "Lost" or "Draw", with the ETH gained or lost for a staked battle. */
export function OutcomeBadge({ battle, account }) {
  const { outcome, net } = resultOf(battle, account);
  return (
    <span className={`badge badge-${outcome}`}>
      {OUTCOME_LABELS[outcome]}
      {battle.stake > 0n && ` ${formatSignedEth(net)}`}
    </span>
  );
}

/** One line per finished battle, for short "recent results" lists. */
export function ResultRow({ battle, account }) {
  const { myCard, theirCard, rival } = sideOf(battle, account);
  const cardName = (card) => (card ? `#${card.tokenId} (${card.power})` : "no reveal");
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
