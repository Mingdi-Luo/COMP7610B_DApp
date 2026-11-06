import { SPECIES } from "../config/species.js";
import { resultOf, sideOf } from "../lib/battles.js";
import { simulateTeamBattle, teamHpFraction } from "../lib/cards.js";
import { formatSignedCoins, shortAddress } from "../lib/format.js";
import Card, { CardBack } from "./Card.jsx";

const OUTCOME_LABELS = { won: "Won", lost: "Lost", draw: "Draw" };

function teamScore(team, hp) {
  const { numerator, denominator } = teamHpFraction(team, hp);
  const hundredths = numerator * 10000n / denominator;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}%`;
}

export function TeamMatchup({ left, right, leftLabel = "You", rightLabel = "Opponent", leftNote, rightNote, showReplay = false }) {
  const result = showReplay && left?.every(Boolean) && right?.every(Boolean) ? simulateTeamBattle(left, right) : null;
  const side = (team, label, note, hp) => (
    <div className="team-fighter">
      <strong>{label}</strong>
      <div className="team-row">
        {[0, 1, 2].map(index => (
          <div key={index} className="team-position">
            <span className="muted">#{index + 1}</span>
            <div className="card-slot">{team?.[index] ? <Card {...team[index]} /> : <CardBack />}</div>
            {hp && <span className={hp[index] === 0n ? "result-lost" : "muted"}>HP {String(hp[index])}/{team[index].maxHP}</span>}
          </div>
        ))}
      </div>
      {note && <p className="muted">{note}</p>}
      {hp && <p className="muted">Remaining HP fractions: {teamScore(team, hp)} / 300%</p>}
    </div>
  );
  return (
    <div className="team-battle">
      <div className="team-matchup">
        {side(left, leftLabel, leftNote, result?.hpA)}
        <span className="duel-vs" aria-hidden="true">VS</span>
        {side(right, rightLabel, rightNote, result?.hpB)}
      </div>
      {result && (
        <details className="combat-replay">
          <summary>{result.rounds} rounds · {result.winner === 0 ? "Draw" : `Winner: ${result.winner === 1 ? leftLabel : rightLabel}`}</summary>
          <p className="muted">Damage includes passives, evaluated before both attacks land. Focus applies once per card; Resonance counts the original lineup.</p>
          <p>{result.hpA.every(hp => hp === 0n) || result.hpB.every(hp => hp === 0n) ? "Team eliminated. Both active cards complete their attacks." : "20-round limit: compare the exact sum of each card's remaining HP / MaxHP. Unused cards count as full HP."}</p>
          <ol>{result.log.map(row => (
            <li key={row.round}>
              Round {row.round}: {leftLabel} #{row.activeA + 1} → {String(row.damageA)} damage;
              {" "}{rightLabel} #{row.activeB + 1} → {String(row.damageB)} damage.
              {" "}HP [{row.hpA.map(String).join(", ")}] / [{row.hpB.map(String).join(", ")}]
            </li>
          ))}</ol>
        </details>
      )}
    </div>
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
  const { myTeam, theirTeam, rival } = sideOf(battle, account);
  const teamName = (team) => team ? team.map(card => SPECIES[card.speciesId].name).join(" → ") : "not revealed";
  return (
    <div className="battle-row">
      <div>
        <strong>Battle #{battle.id}</strong>
        <span className="muted"> vs {shortAddress(rival)} · {teamName(myTeam)} vs {teamName(theirTeam)}</span>
      </div>
      <OutcomeBadge battle={battle} account={account} />
    </div>
  );
}
