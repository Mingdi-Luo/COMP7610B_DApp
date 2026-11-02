import { txUrl } from "../config/chains.js";
import { shortAddress } from "../lib/format.js";

/**
 * Shows the state of a useTx() transaction, with an explorer link once it is sent.
 * `floating` pins it to the corner of the screen, for long pages such as the Arena.
 */
export default function TxStatus({ tx, floating = false }) {
  if (tx.phase === "idle") return null;

  const link = txUrl(tx.hash);
  return (
    <div className={`tx-status tx-${tx.phase}${floating ? " tx-floating" : ""}`} role="status">
      <p>{tx.message}</p>
      {tx.hash && (link ? (
        <a href={link} target="_blank" rel="noreferrer">View transaction {shortAddress(tx.hash)} ↗</a>
      ) : (
        <code title={tx.hash}>Transaction {shortAddress(tx.hash)}</code>
      ))}
      {floating && !tx.busy && (
        <button type="button" className="tx-close" aria-label="Dismiss" onClick={tx.reset}>×</button>
      )}
    </div>
  );
}
