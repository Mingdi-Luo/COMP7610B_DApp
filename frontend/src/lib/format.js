import { formatEther } from "ethers";

export const shortAddress = (address) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

/** MetaMask reports lowercase addresses while contracts return checksummed ones. */
export const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

/** "0.001 ETH" from a wei amount (bigint); whole amounts drop the ".0" ethers adds. */
export const formatEth = (wei) => `${formatEther(wei).replace(/\.0$/, "")} ETH`;

/** "1,000 DUEL" from a coin amount (bigint). */
export const formatCoins = (coins) => `${coins.toLocaleString("en-US")} DUEL`;

/** "+1,000 DUEL", "-1,000 DUEL" or "0 DUEL" from a signed coin amount. */
export const formatSignedCoins = (coins) =>
  `${coins > 0n ? "+" : coins < 0n ? "-" : ""}${formatCoins(coins < 0n ? -coins : coins)}`;

/** "9:05" from a number of seconds. */
export function formatCountdown(seconds) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Local date and time from unix seconds. */
export const formatDateTime = (seconds) => new Date(seconds * 1000).toLocaleString();
