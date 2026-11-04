import { Matchup, OutcomeBadge } from "../components/BattleCards.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { HISTORY_SIZE, useBattles } from "../hooks/useBattles.js";
import { useWallet } from "../hooks/useWallet.jsx";
import { REVEAL_WINDOW, describeResult, recordOf, resultOf, sideOf, stakeLabel } from "../lib/battles.js";
import { formatDateTime, formatSignedCoins, shortAddress } from "../lib/format.js";

export default function History({ onNavigate }) {
  return (
    <section className="panel">
      <h1>Battle history</h1>
      <p className="lead">
        Your last {HISTORY_SIZE} finished battles, read from the Arena contract. Cards appear as they
        were when revealed, even if you merged them later.
      </p>
      <WalletGate>
        <HistoryList onNavigate={onNavigate} />
      </WalletGate>
    </section>
  );
}

function HistoryList({ onNavigate }) {
  const { account } = useWallet();
  const { finishedBattles, loaded, error } = useBattles();

  if (!loaded) return <p className="muted">Loading battles...</p>;

  const record = recordOf(finishedBattles, account);
  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}
      {finishedBattles.length === 0 ? (
        <div className="notice">
          <p>No finished battles yet.</p>
          <button type="button" onClick={() => onNavigate("arena")}>Go to the Arena</button>
        </div>
      ) : (
        <>
          <p className="collection-summary">
            <strong>{finishedBattles.length} battle{finishedBattles.length === 1 ? "" : "s"}</strong>
            <span className="result-won">{record.won} won</span>
            <span className="result-lost">{record.lost} lost</span>
            <span>{record.draw} drawn</span>
            <span>Net {formatSignedCoins(record.net)}</span>
          </p>
          <div className="battle-list">
            {finishedBattles.map((battle) => (
              <HistoryEntry key={battle.id} battle={battle} account={account} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function HistoryEntry({ battle, account }) {
  const { rival, myCard, theirCard } = sideOf(battle, account);
  const { outcome } = resultOf(battle, account);
  const bothRevealed = battle.creatorRevealed && battle.opponentRevealed;

  return (
    <article className="battle">
      <header className="battle-header">
        <strong>Battle #{battle.id}</strong>
        <span className="muted">
          vs {shortAddress(rival)} · started {formatDateTime(battle.revealDeadline - REVEAL_WINDOW)}
        </span>
        <span className="battle-stake">{stakeLabel(battle.stake)}</span>
        <OutcomeBadge battle={battle} account={account} />
      </header>
      <p className={`outcome result-${outcome}`}>{describeResult(battle, account)}</p>
      <Matchup
        left={myCard}
        right={theirCard}
        leftNote={myCard ? null : "Not revealed"}
        rightNote={theirCard ? null : "Not revealed"}
        showPower={bothRevealed}
      />
    </article>
  );
}
