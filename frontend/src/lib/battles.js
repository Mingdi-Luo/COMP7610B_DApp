import { ZeroAddress } from "ethers";
import { BATTLE_STATUS } from "../config/contracts.js";
import { formatCoins, sameAddress } from "./format.js";

// { None: 0, Open: 1, Joined: 2, Resolved: 3, Cancelled: 4 }
export const STATUS = Object.fromEntries(BATTLE_STATUS.map((name, index) => [name, index]));

// Mirrors Arena.REVEAL_WINDOW, in seconds.
export const REVEAL_WINDOW = 600;

export const stakeLabel = (stake) => (stake > 0n ? `Stake ${formatCoins(stake)}` : "Friendly match");

/** A battle seen from one player's side. Cards are null until that side reveals. */
export function sideOf(battle, account) {
  const isCreator = sameAddress(battle.creator, account);
  return {
    isCreator,
    rival: isCreator ? battle.opponent : battle.creator,
    myCommitment: isCreator ? battle.creatorCommitment : battle.opponentCommitment,
    iRevealed: isCreator ? battle.creatorRevealed : battle.opponentRevealed,
    theyRevealed: isCreator ? battle.opponentRevealed : battle.creatorRevealed,
    myCard: isCreator ? battle.creatorCard : battle.opponentCard,
    theirCard: isCreator ? battle.opponentCard : battle.creatorCard,
  };
}

/** "won", "lost" or "draw" for a resolved battle, and the coins it gained or lost. */
export function resultOf(battle, account) {
  if (sameAddress(battle.winner, account)) return { outcome: "won", net: battle.stake };
  if (battle.winner === ZeroAddress) return { outcome: "draw", net: 0n };
  return { outcome: "lost", net: -battle.stake };
}

/** Wins, losses, draws and net coins over resolved battles. */
export function recordOf(battles, account) {
  const record = { won: 0, lost: 0, draw: 0, net: 0n };
  for (const battle of battles) {
    const { outcome, net } = resultOf(battle, account);
    record[outcome] += 1;
    record.net += net;
  }
  return record;
}

/** One sentence explaining how a resolved battle ended. */
export function describeResult(battle, account) {
  const { iRevealed } = sideOf(battle, account);
  const { outcome } = resultOf(battle, account);
  const bothRevealed = battle.creatorRevealed && battle.opponentRevealed;
  const staked = battle.stake > 0n;

  if (outcome === "draw") {
    if (!bothRevealed) return "Nobody revealed in time. Both stakes were refunded.";
    return staked ? "Draw. Both stakes were refunded." : "Draw.";
  }
  let text = outcome === "won" ? `You won${staked ? ` ${formatCoins(battle.stake * 2n)}` : ""}!` : "You lost.";
  if (!bothRevealed) text += iRevealed ? " Your opponent did not reveal in time." : " You did not reveal in time.";
  return text;
}
