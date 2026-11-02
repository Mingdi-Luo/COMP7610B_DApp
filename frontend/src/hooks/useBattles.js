import { useCallback, useEffect, useRef, useState } from "react";
import { contractsConfigured, getArenaContract } from "../config/contracts.js";
import { STATUS } from "../lib/battles.js";
import { toCard } from "../lib/cards.js";
import { readableError } from "../lib/errors.js";
import { sameAddress } from "../lib/format.js";
import { useWallet } from "./useWallet.jsx";

// Open battles are found among the newest battles; the player's own come from battlesOf.
const RECENT_BATTLES = 30;
const MY_BATTLES = 50;
export const HISTORY_SIZE = 20;
const POLL_MS = 10_000;

/**
 * Arena battles for the connected player, refreshed every few seconds so the
 * other player's moves show up:
 * - openBattles: other players' battles waiting for an opponent
 * - activeBattles: the player's Open and Joined battles
 * - finishedBattles: the player's last HISTORY_SIZE resolved battles (cancelled ones are left out)
 * Battles are plain objects, newest first: status is a number in STATUS order, stake a
 * bigint, revealDeadline unix seconds, and creatorCard / opponentCard the cards as
 * revealed (null until that side reveals).
 */
export function useBattles() {
  const { account, isCorrectChain, getProvider } = useWallet();
  const [battles, setBattles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  // Resolved and cancelled battles never change, so each is fetched once.
  const finished = useRef(new Map());
  const lastCount = useRef(0);
  // Ignores a slow response that an account switch has already replaced.
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    if (!isCorrectChain || !contractsConfigured) {
      setBattles([]);
      return;
    }

    try {
      const arena = getArenaContract(getProvider());
      const count = Number(await arena.battleCount());
      // A smaller count means the local chain was restarted, so forget the old battles.
      if (count < lastCount.current) finished.current.clear();
      lastCount.current = count;

      const recentIds = Array.from({ length: Math.min(count, RECENT_BATTLES) }, (_, index) => count - index);
      const myIds = account ? Array.from(await arena.battlesOf(account), Number).slice(-MY_BATTLES) : [];
      const ids = [...new Set([...recentIds, ...myIds])].sort((a, b) => b - a);

      const loadedBattles = await Promise.all(ids.map((id) => finished.current.get(id) ?? loadBattle(arena, id)));
      for (const battle of loadedBattles) {
        if (battle.status === STATUS.Resolved || battle.status === STATUS.Cancelled) {
          finished.current.set(battle.id, battle);
        }
      }

      if (request !== latestRequest.current) return;
      setBattles(loadedBattles);
      setError("");
    } catch (err) {
      if (request === latestRequest.current) setError(readableError(err));
    } finally {
      if (request === latestRequest.current) setLoaded(true);
    }
  }, [account, isCorrectChain, getProvider]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const mine = battles.filter((battle) => sameAddress(battle.creator, account) || sameAddress(battle.opponent, account));
  return {
    openBattles: battles.filter((battle) => battle.status === STATUS.Open && !sameAddress(battle.creator, account)),
    activeBattles: mine.filter((battle) => battle.status === STATUS.Open || battle.status === STATUS.Joined),
    finishedBattles: mine.filter((battle) => battle.status === STATUS.Resolved).slice(0, HISTORY_SIZE),
    loaded,
    error,
    refresh,
  };
}

async function loadBattle(arena, id) {
  const battle = toBattle(id, await arena.getBattle(id));
  if (battle.creatorRevealed || battle.opponentRevealed) {
    // Cards as they were at reveal time, even if they were merged away since.
    const [creatorCard, opponentCard] = await arena.getRevealedCards(id);
    if (battle.creatorRevealed) battle.creatorCard = toCard(battle.creatorTokenId, creatorCard);
    if (battle.opponentRevealed) battle.opponentCard = toCard(battle.opponentTokenId, opponentCard);
  }
  return battle;
}

function toBattle(id, battle) {
  return {
    id,
    creator: battle.creator,
    opponent: battle.opponent,
    stake: battle.stake,
    creatorCommitment: battle.creatorCommitment,
    opponentCommitment: battle.opponentCommitment,
    creatorTokenId: Number(battle.creatorTokenId),
    opponentTokenId: Number(battle.opponentTokenId),
    creatorRevealed: battle.creatorRevealed,
    opponentRevealed: battle.opponentRevealed,
    revealDeadline: Number(battle.revealDeadline),
    status: Number(battle.status),
    winner: battle.winner,
    creatorCard: null,
    opponentCard: null,
  };
}
