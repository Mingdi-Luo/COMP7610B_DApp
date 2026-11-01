import WalletGate from "../components/WalletGate.jsx";

/**
 * TODO(frontend B): the battle lobby. Contract: getArenaContract() in config/contracts.js.
 *
 * Create: pick a card and a stake -> salt = newSalt();
 *   commitment = computeCommitment(tokenId, salt, account); saveSecret(commitment, { tokenId, salt })
 *   (warn the player if it returns false) -> createBattle(commitment, { value: stake }).
 * Join: list battles 1..battleCount() with getBattle(id), show Status.Open ones not created by
 *   the player -> same commit steps -> joinBattle(id, commitment, { value: battle.stake }).
 * My battles: for Joined battles, loadSecret(myCommitment) -> reveal(id, tokenId, salt).
 *   After revealDeadline offer claimTimeout(id); while Open let the creator cancelBattle(id).
 * Result: both cards, the element advantage, effective power, the winner and the payout.
 * Helpers live in lib/commitment.js; status names in BATTLE_STATUS.
 */
export default function Arena() {
  return (
    <section className="panel">
      <h1>Arena</h1>
      <p className="lead">
        Stake ETH on a duel. Both players commit a hidden card, then reveal; the stronger card wins
        the pot, and an element advantage multiplies power by 1.5.
      </p>
      <WalletGate>
        <p className="notice">Coming soon.</p>
      </WalletGate>
    </section>
  );
}
