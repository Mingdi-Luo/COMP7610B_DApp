import { formatEther } from "ethers";

export const shortAddress = (address) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

/** MetaMask reports lowercase addresses while contracts return checksummed ones. */
export const sameAddress = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

/** "0.001 ETH" from a wei amount (bigint); whole amounts drop the ".0" ethers adds. */
export const formatEth = (wei) => `${formatEther(wei).replace(/\.0$/, "")} ETH`;

/** "+0.001 ETH", "-0.001 ETH" or "0 ETH" from a signed wei amount. */
export const formatSignedEth = (wei) =>
  `${wei > 0n ? "+" : wei < 0n ? "-" : ""}${formatEth(wei < 0n ? -wei : wei)}`;

/** "9:05" from a number of seconds. */
export function formatCountdown(seconds) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Local date and time from unix seconds. */
export const formatDateTime = (seconds) => new Date(seconds * 1000).toLocaleString();
