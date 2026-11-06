import { ResultRow } from "../components/BattleCards.jsx";
import { ELEMENTS, PACK_PRICE, RARITIES, contractsConfigured } from "../config/contracts.js";
import { SPECIES } from "../config/species.js";
import { useBattles } from "../hooks/useBattles.js";
import { useCoins } from "../hooks/useCoins.jsx";
import { useMyCards } from "../hooks/useMyCards.js";
import { useNow } from "../hooks/useNow.js";
import { useWallet } from "../hooks/useWallet.jsx";
import { STATUS, recordOf, sideOf, stakeLabel } from "../lib/battles.js";
import { formatCoins, formatCountdown, formatSignedCoins, shortAddress } from "../lib/format.js";

const LEGENDARY = RARITIES.length - 1;

export default function Home({ onNavigate }) {
  const { account, isCorrectChain } = useWallet();
  if (!account || !isCorrectChain || !contractsConfigured) return <Intro onNavigate={onNavigate} />;
  return <Dashboard onNavigate={onNavigate} />;
}

function Intro({ onNavigate }) {
  const { balance } = useCoins();
  const canOpenPack = balance !== null && balance >= PACK_PRICE;

  return (
    <section className="panel">
      <span className="eyebrow">On-chain creature card game</span>
      <h1>Elemental Duel</h1>
      <p className="lead">
        Collect creature card NFTs, make them stronger, and stake coins in duels where neither player can
        peek at the other&apos;s card.
      </p>

      <ol className="steps">
        <li><strong>Top up.</strong> Buy Duel Coin with ETH. Everything in the game is priced in coins.</li>
        <li><strong>Collect.</strong> Each pack mints one creature. The drop rates live in the contract, so anyone can audit them.</li>
        <li><strong>Improve.</strong> Merge three cards into a rarer one, enchant a random passive, or breed new creatures. Decompose what you do not need for coins.</li>
        <li><strong>Duel.</strong> Commit three cards in order and reveal your team. Fight a relay battle with survivor HP carried over and a global 20-round limit.</li>
      </ol>

      <button type="button" onClick={() => onNavigate(canOpenPack ? "shop" : "topup")}>
        {canOpenPack ? "Open your first pack" : "Top up to get started"}
      </button>
    </section>
  );
}

/** Live overview for a returning player: stats, battles that need action, recent results. */
function Dashboard({ onNavigate }) {
  const { account } = useWallet();
  const { balance } = useCoins();
  const { cards, loaded: cardsLoaded } = useMyCards();
  const { openBattles, activeBattles, finishedBattles, loaded: battlesLoaded } = useBattles();
  const now = useNow();

  // A brand-new player sees the introduction until their first card or battle.
  const isNewPlayer = cards.length === 0 && activeBattles.length === 0 && finishedBattles.length === 0;
  if (cardsLoaded && battlesLoaded && isNewPlayer) return <Intro onNavigate={onNavigate} />;

  const record = recordOf(finishedBattles, account);
  const inPlay = activeBattles.reduce((total, battle) => total + battle.stake, 0n);
  const counts = RARITIES.map((_, rarity) => cards.filter((card) => card.rarity === rarity).length);
  const strongest = cards.reduce((best, card) => (!best || card.atk > best.atk ? card : best), null);
  const tasks = buildTasks({ activeBattles, openBattles, counts, balance, account, now });
  const pending = (value) => (cardsLoaded && battlesLoaded ? value : "…");

  return (
    <section className="panel">
      <span className="eyebrow">Your dashboard</span>
      <h1>Welcome back</h1>
      <p className="lead">
        Playing as <code>{shortAddress(account)}</code>. Battles refresh every 10 seconds.
      </p>

      <div className="stat-grid">
        <Stat
          label="Coins"
          value={balance === null ? "…" : balance.toLocaleString("en-US")}
          detail={inPlay > 0n ? `DUEL · ${formatCoins(inPlay)} in play` : "DUEL"}
        />
        <Stat
          label="Cards owned"
          value={pending(cards.length)}
          detail={RARITIES.map((name, rarity) => `${counts[rarity]} ${name}`).join(" · ")}
        />
        <Stat
          label="Battle record"
          value={pending(`${record.won}–${record.lost}–${record.draw}`)}
          detail="Won–lost–drawn, last 20 battles"
        />
        <Stat
          label="Battle earnings"
          value={pending(formatSignedCoins(record.net))}
          detail="Net over the last 20 battles"
        />
        <Stat
          label="Highest ATK"
          value={pending(strongest ? strongest.atk : "–")}
          detail={
            strongest
              ? `${SPECIES[strongest.speciesId].name}, ${RARITIES[strongest.rarity]} ${ELEMENTS[strongest.element]} #${strongest.tokenId}`
              : "No cards yet"
          }
        />
      </div>

      <h2>Needs your attention</h2>
      {tasks.length > 0 ? (
        <div className="battle-list">
          {tasks.map((task) => (
            <div key={task.key} className="battle-row">
              <div>{task.text}</div>
              <span className={`badge ${task.urgent ? "badge-urgent" : ""}`}>{task.urgent ? "Action needed" : task.tag}</span>
              <button
                type="button"
                className={task.urgent ? "" : "button-secondary"}
                onClick={() => onNavigate(task.page)}
              >
                {task.button}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{battlesLoaded ? "Nothing needs your attention right now." : "Loading battles..."}</p>
      )}

      <h2>Recent results</h2>
      {finishedBattles.length > 0 ? (
        <>
          <div className="battle-list">
            {finishedBattles.slice(0, 3).map((battle) => (
              <ResultRow key={battle.id} battle={battle} account={account} />
            ))}
          </div>
          <button type="button" className="button-link" onClick={() => onNavigate("history")}>
            See your last 20 battles in History
          </button>
        </>
      ) : (
        <p className="muted">No finished battles yet.</p>
      )}

      <div className="toolbar quick-actions">
        <button type="button" onClick={() => onNavigate("shop")}>Open a pack</button>
        <button type="button" className="button-secondary" onClick={() => onNavigate("forge")}>Forge</button>
        <button type="button" className="button-secondary" onClick={() => onNavigate("arena")}>Arena</button>
        <button type="button" className="button-secondary" onClick={() => onNavigate("odds")}>Rules</button>
      </div>
    </section>
  );
}

function Stat({ label, value, detail }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-detail">{detail}</span>
    </div>
  );
}

/** Things the player can act on now, the urgent ones (reveal or settle) first. */
function buildTasks({ activeBattles, openBattles, counts, balance, account, now }) {
  const tasks = [];
  for (const battle of activeBattles) {
    const { iRevealed, theyRevealed } = sideOf(battle, account);
    const secondsLeft = battle.revealDeadline - now;
    const base = { key: `battle-${battle.id}`, page: "arena", button: "Go to Arena" };

    if (battle.status === STATUS.Open) {
      tasks.push({ ...base, tag: "Waiting", text: `Battle #${battle.id} is waiting for an opponent (${stakeLabel(battle.stake)}).` });
    } else if (secondsLeft < 0) {
      let next = "Settle it to refund both stakes.";
      if (iRevealed) next = "Claim the pot.";
      else if (theyRevealed) next = "Your opponent wins by timeout; settle it.";
      tasks.push({ ...base, urgent: true, text: `Battle #${battle.id}: the reveal window has closed. ${next}` });
    } else if (!iRevealed) {
      const hint = theyRevealed ? " Your opponent has already revealed." : "";
      tasks.push({ ...base, urgent: true, text: `Battle #${battle.id}: reveal your card within ${formatCountdown(secondsLeft)}.${hint}` });
    } else {
      tasks.push({ ...base, tag: "Waiting", text: `Battle #${battle.id}: waiting for your opponent to reveal (${formatCountdown(secondsLeft)} left).` });
    }
  }

  if (openBattles.length > 0) {
    const count = openBattles.length;
    tasks.push({
      key: "open-battles",
      page: "arena",
      button: "Join one",
      tag: "Challenge",
      text: `${count} open battle${count > 1 ? "s" : ""} from other players ${count > 1 ? "are" : "is"} waiting for a challenger.`,
    });
  }

  const mergeable = counts.findIndex((count, rarity) => rarity !== LEGENDARY && count >= 3);
  if (mergeable >= 0) {
    tasks.push({
      key: "merge",
      page: "forge",
      button: "Go to the Forge",
      tag: "Tip",
      text: `You have ${counts[mergeable]} ${RARITIES[mergeable]} cards. Merge three into a ${RARITIES[mergeable + 1]} card.`,
    });
  }

  if (balance !== null && balance < PACK_PRICE) {
    tasks.push({
      key: "top-up",
      page: "topup",
      button: "Top up",
      tag: "Tip",
      text: `You have ${formatCoins(balance)}. A pack costs ${formatCoins(PACK_PRICE)}.`,
    });
  }

  return tasks.sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
}
