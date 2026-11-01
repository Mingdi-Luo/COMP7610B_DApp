import { hexlify, randomBytes, solidityPackedKeccak256 } from "ethers";

/**
 * Commit-reveal helpers for Arena battles.
 *
 * A player first submits hash(tokenId, salt, player) so the opponent cannot
 * see their card, then later reveals tokenId + salt. If the salt is lost the
 * player cannot reveal and loses on timeout, so it is saved in localStorage,
 * keyed by the commitment (which is also stored on-chain in the battle).
 */

const STORAGE_PREFIX = "elemental-duel:secret:";

export function newSalt() {
  return hexlify(randomBytes(32));
}

/** Must match Arena.computeCommitment in Solidity. */
export function computeCommitment(tokenId, salt, player) {
  return solidityPackedKeccak256(["uint256", "bytes32", "address"], [tokenId, salt, player]);
}

export function saveSecret(commitment, { tokenId, salt }) {
  try {
    localStorage.setItem(STORAGE_PREFIX + commitment, JSON.stringify({ tokenId: String(tokenId), salt }));
    return true;
  } catch {
    // Private windows can block storage; the caller should warn the player.
    return false;
  }
}

/** Returns { tokenId, salt } or null if this browser never saved the secret. */
export function loadSecret(commitment) {
  try {
    const saved = localStorage.getItem(STORAGE_PREFIX + commitment);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}
