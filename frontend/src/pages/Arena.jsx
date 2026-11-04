import { useState } from "react";
import { ZeroAddress } from "ethers";
import { Matchup, ResultRow } from "../components/BattleCards.jsx";
import Card from "../components/Card.jsx";
import TxStatus from "../components/TxStatus.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { BATTLE_STATUS, getArenaContract } from "../config/contracts.js";
import { useBattles } from "../hooks/useBattles.js";
import { useCoins } from "../hooks/useCoins.jsx";
import { useMyCards } from "../hooks/useMyCards.js";
import { useNow } from "../hooks/useNow.js";
import { useTx } from "../hooks/useTx.js";
import { useWallet } from "../hooks/useWallet.jsx";
import { STATUS, sideOf, stakeLabel } from "../lib/battles.js";
import { computeCommitment, loadSecret, newSalt, saveSecret } from "../lib/commitment.js";
import { formatCoins, formatCountdown, sameAddress, shortAddress } from "../lib/format.js";

export default function Arena({ onNavigate }) {
  return (
    <section className="panel">
      <h1>Arena</h1>
      <p className="lead">
        Stake coins on a duel. Both players commit a hidden card, then reveal it within 10 minutes.
        Elements can double or halve a card's power, and the stronger card takes the pot.
      </p>
      <WalletGate>
        <Lobby onNavigate={onNavigate} />
      </WalletGate>
    </section>
  );
}

function Lobby({ onNavigate }) {
  const { account, getSigner } = useWallet();
  const { cards } = useMyCards();
  const { openBattles, activeBattles, finishedBattles, loaded, error, refresh } = useBattles();
  const { balance } = useCoins();
  const tx = useTx();
  const now = useNow();
  const [fighterId, setFighterId] = useState(null);
  const [stakeInput, setStakeInput] = useState("1000");

  const fighter = cards.find((card) => card.tokenId === fighterId);
  const stake = parseStake(stakeInput);
  const canAfford = (amount) => balance === null || balance >= amount;

  // Sends one Arena transaction from the connected account, then reloads the battles.
  async function send(action, messages) {
    const receipt = await tx.run(async () => {
      const signer = await getSigner();
      return action(getArenaContract(signer), await signer.getAddress());
    }, messages);
    if (receipt) refresh();
  }

  // Hides the fighter behind a commitment and keeps the salt in this browser for the reveal.
  function commitFighter(player) {
    const salt = newSalt();
    const commitment = computeCommitment(fighter.tokenId, salt, player);
    if (!saveSecret(commitment, { tokenId: fighter.tokenId, salt })) {
      throw new Error("This browser blocked local storage, so it cannot keep the secret you need to reveal. Use a normal window.");
    }
    return commitment;
  }

  const createBattle = () =>
    send((arena, player) => arena.createBattle(commitFighter(player), stake), {
      pending: "Creating the battle...",
      success: "Battle created. Waiting for an opponent to join.",
    });

  const joinBattle = (battle) =>
    send((arena, player) => arena.joinBattle(battle.id, commitFighter(player)), {
      pending: `Joining battle #${battle.id}...`,
      success: "Joined! Both players now have 10 minutes to reveal.",
    });

  const reveal = (battle) =>
    send(
      (arena, player) => {
        const commitment = sameAddress(battle.creator, player) ? battle.creatorCommitment : battle.opponentCommitment;
        const secret = loadSecret(commitment);
        if (!secret) {
          throw new Error(`This browser has no saved secret for battle #${battle.id}. Reveal from the browser you used to commit.`);
        }
        return arena.reveal(battle.id, secret.tokenId, secret.salt);
      },
      { pending: "Revealing your card...", success: "Card revealed. Finished battles move to History." },
    );

  const claimTimeout = (battle) =>
    send((arena) => arena.claimTimeout(battle.id), {
      pending: "Settling the battle...",
      success: "Battle settled. See the result in History.",
    });

  const cancelBattle = (battle) =>
    send((arena) => arena.cancelBattle(battle.id), {
      pending: "Cancelling the battle...",
      success: "Battle cancelled and stake refunded.",
    });

  return (
    <>
      <TxStatus tx={tx} floating />
      {error && <p className="notice notice-error">{error}</p>}

      <h2>Your active battles</h2>
      {activeBattles.length > 0 ? (
        <div className="battle-list">
          {activeBattles.map((battle) => (
            <ActiveBattle
              key={battle.id}
              battle={battle}
              account={account}
              myCards={cards}
              now={now}
              busy={tx.busy}
              onReveal={reveal}
              onClaim={claimTimeout}
              onCancel={cancelBattle}
            />
          ))}
        </div>
      ) : (
        <p className="muted">{loaded ? "No active battles. Pick a fighter below to create or join one." : "Loading battles..."}</p>
      )}

      {finishedBattles.length > 0 && (
        <>
          <h3>Recent results</h3>
          <div className="battle-list">
            {finishedBattles.slice(0, 3).map((battle) => (
              <ResultRow key={battle.id} battle={battle} account={account} />
            ))}
          </div>
          <button type="button" className="button-link" onClick={() => onNavigate("history")}>
            See your last 20 battles in History
          </button>
        </>
      )}

      <h2>1. Choose your fighter</h2>
      <p className="muted">
        Your opponent sees only a hash until you reveal. The secret needed to reveal is saved in this
        browser, so reveal from here too.
      </p>
      {cards.length > 0 ? (
        <div className="card-grid">
          {cards.map((card) => (
            <Card
              key={card.tokenId}
              {...card}
              selected={card.tokenId === fighterId}
              onClick={() => setFighterId((id) => (id === card.tokenId ? null : card.tokenId))}
            />
          ))}
        </div>
      ) : (
        <div className="notice">
          <p>You need a card to fight.</p>
          <button type="button" onClick={() => onNavigate("shop")}>Go to the shop</button>
        </div>
      )}

      <h2>2. Create or join a battle</h2>
      <div className="create-battle">
        <label className="field">
          <span>Stake (DUEL)</span>
          <input
            type="text"
            inputMode="numeric"
            value={stakeInput}
            onChange={(event) => setStakeInput(event.target.value)}
            aria-invalid={stake === null}
          />
        </label>
        <button
          type="button"
          onClick={createBattle}
          disabled={!fighter || stake === null || !canAfford(stake) || tx.busy}
        >
          Create battle
        </button>
      </div>
      {stake === null && <p className="field-error">Enter a whole number of coins, or 0 for a friendly match.</p>}
      {stake !== null && !canAfford(stake) && (
        <div className="notice">
          <p>You have {formatCoins(balance)}, which is not enough for this stake.</p>
          <button type="button" onClick={() => onNavigate("topup")}>Top up</button>
        </div>
      )}
      {!fighter && <p className="muted">Pick a fighter above first.</p>}

      <h3>Open battles</h3>
      {openBattles.length > 0 ? (
        <div className="battle-list">
          {openBattles.map((battle) => (
            <div key={battle.id} className="battle-row">
              <div>
                <strong>Battle #{battle.id}</strong>
                <span className="muted"> by {shortAddress(battle.creator)} · card hidden</span>
              </div>
              <span className="battle-stake">{stakeLabel(battle.stake)}</span>
              <button
                type="button"
                onClick={() => joinBattle(battle)}
                disabled={!fighter || !canAfford(battle.stake) || tx.busy}
              >
                Join
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          No open battles from other players. Create one, then switch MetaMask to a second account to
          join it.
        </p>
      )}
    </>
  );
}

function ActiveBattle({ battle, account, myCards, now, busy, onReveal, onClaim, onCancel }) {
  const { isCreator, rival, myCommitment, iRevealed, theyRevealed, myCard: revealedCard, theirCard } = sideOf(battle, account);
  // Before the reveal, only this browser knows the committed card, from the saved secret.
  const secret = loadSecret(myCommitment);
  const committedId = secret ? Number(secret.tokenId) : null;
  const myCard = revealedCard ?? myCards.find((card) => card.tokenId === committedId) ?? null;
  const secondsLeft = battle.revealDeadline - now;

  let myNote = "Hidden from your opponent";
  if (iRevealed) myNote = "Revealed";
  else if (!secret) myNote = "Secret not saved in this browser";
  else if (!myCard) myNote = `Card #${committedId} is no longer yours`;

  let theirNote = "Hidden until revealed";
  if (battle.status === STATUS.Open) theirNote = "No opponent yet";
  else if (theyRevealed) theirNote = "Revealed";

  let action;
  if (battle.status === STATUS.Open) {
    action = (
      <>
        <p>Waiting for an opponent to join.</p>
        <button type="button" className="button-secondary" onClick={() => onCancel(battle)} disabled={busy}>
          Cancel and refund
        </button>
      </>
    );
  } else if (secondsLeft >= 0) {
    let situation = isCreator ? "Your opponent has joined." : "You joined this battle.";
    if (theyRevealed) situation = "Your opponent has revealed.";
    action = iRevealed ? (
      <p>Waiting for your opponent to reveal ({formatCountdown(secondsLeft)} left).</p>
    ) : (
      <>
        <p>
          {situation} Reveal your card within {formatCountdown(secondsLeft)}, or you lose the stake.
        </p>
        <button type="button" onClick={() => onReveal(battle)} disabled={busy}>Reveal my card</button>
      </>
    );
  } else {
    let label = "Refund both stakes";
    if (iRevealed) label = "Claim the pot";
    else if (theyRevealed) label = "Settle (your opponent wins)";
    action = (
      <>
        <p>The reveal window has closed.</p>
        <button type="button" onClick={() => onClaim(battle)} disabled={busy}>{label}</button>
      </>
    );
  }

  const statusName = BATTLE_STATUS[battle.status];
  return (
    <article className="battle">
      <header className="battle-header">
        <strong>Battle #{battle.id}</strong>
        <span className="muted">
          {isCreator ? "Created by you" : "Joined by you"}
          {rival !== ZeroAddress && ` · vs ${shortAddress(rival)}`}
        </span>
        <span className="battle-stake">{stakeLabel(battle.stake)}</span>
        <span className={`badge badge-${statusName.toLowerCase()}`}>{statusName}</span>
      </header>
      <div className="battle-body">
        <Matchup left={myCard} right={theirCard} leftNote={myNote} rightNote={theirNote} />
        <div className="battle-action">{action}</div>
      </div>
    </article>
  );
}

/** The stake as a bigint, or null unless the input is a whole number of coins. */
function parseStake(text) {
  const trimmed = text.trim() || "0";
  return /^\d+$/.test(trimmed) ? BigInt(trimmed) : null;
}
