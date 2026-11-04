import { useCallback, useState } from "react";
import { readableError } from "../lib/errors.js";
import { useCoins } from "./useCoins.jsx";

const IDLE = { phase: "idle", hash: "", message: "" };

/**
 * Tracks one transaction: signing -> pending -> success | error.
 * Render the result with <TxStatus tx={tx} />. The coin balance refreshes after each success.
 *
 *   const tx = useTx();
 *   const receipt = await tx.run(() => contract.openPack(), { success: "Pack opened!" });
 */
export function useTx() {
  const { refresh: refreshCoins } = useCoins();
  const [state, setState] = useState(IDLE);

  const run = useCallback(async (send, { pending = "Waiting for confirmation...", success = "Transaction confirmed." } = {}) => {
    setState({ phase: "signing", hash: "", message: "Confirm the transaction in MetaMask..." });
    try {
      // send() returns once the user approves in MetaMask and the transaction is broadcast.
      const transaction = await send();
      setState({ phase: "pending", hash: transaction.hash, message: pending });

      // wait() resolves after the transaction is mined, not merely submitted.
      const receipt = await transaction.wait();
      setState({ phase: "success", hash: transaction.hash, message: success });
      refreshCoins();
      return receipt;
    } catch (error) {
      setState((previous) => ({ phase: "error", hash: previous.hash, message: readableError(error) }));
      return null;
    }
  }, [refreshCoins]);

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, busy: state.phase === "signing" || state.phase === "pending", run, reset };
}
