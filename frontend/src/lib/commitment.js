import { hexlify, randomBytes, solidityPackedKeccak256 } from "ethers";

/**
 * Commit-reveal helpers for Arena battles.
 *
 * A player first submits hash(ordered tokenIds[3], salt, player) so the opponent cannot
 * see their team, then later reveals the same ordered tokenIds + salt. If the salt is lost the
 * player cannot reveal and loses on timeout, so it is saved in localStorage,
 * keyed by the commitment (which is also stored on-chain in the battle).
 */

const STORAGE_PREFIX = "elemental-duel:secret:";

export function newSalt() {
  return hexlify(randomBytes(32));
}

/** Must match Arena.computeCommitment in Solidity. */
export function computeCommitment(tokenIds, salt, player) {
  if (tokenIds.length !== 3 || new Set(tokenIds.map(String)).size !== 3) throw new Error("Choose three different cards in order.");
  return solidityPackedKeccak256(["uint256[3]", "bytes32", "address"], [tokenIds, salt, player]);
}

export function saveSecret(commitment, { tokenIds, salt }) {
  try {
    localStorage.setItem(STORAGE_PREFIX + commitment, JSON.stringify({ tokenIds: tokenIds.map(String), salt }));
    return true;
  } catch {
    // Private windows can block storage; the caller should warn the player.
    return false;
  }
}

/** Returns { tokenIds, salt } or null for missing or legacy single-card secrets. */
export function loadSecret(commitment) {
  try {
    const saved = localStorage.getItem(STORAGE_PREFIX + commitment);
    const secret = saved ? JSON.parse(saved) : null;
    return secret?.tokenIds?.length === 3 ? secret : null;
  } catch {
    return null;
  }
}
