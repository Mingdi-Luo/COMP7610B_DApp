import { TARGET_CHAIN } from "../config/chains.js";
import { contractsConfigured } from "../config/contracts.js";
import { useWallet } from "../hooks/useWallet.jsx";

/**
 * Renders its children only when the wallet is connected to the right network
 * and the contracts are deployed there; otherwise explains what is missing.
 */
export default function WalletGate({ children }) {
  const { hasWallet, account, isCorrectChain, connect, switchToTargetChain } = useWallet();

  if (!hasWallet) {
    return (
      <p className="notice">
        Install <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> in
        this browser, then reload the page.
      </p>
    );
  }
  if (!account) {
    return (
      <div className="notice">
        <p>Connect your wallet to continue.</p>
        <button type="button" onClick={connect}>Connect MetaMask</button>
      </div>
    );
  }
  if (!isCorrectChain) {
    return (
      <div className="notice notice-warning">
        <p>MetaMask is on a different network. This DApp runs on {TARGET_CHAIN.name}.</p>
        <button type="button" onClick={switchToTargetChain}>Switch to {TARGET_CHAIN.name}</button>
      </div>
    );
  }
  if (!contractsConfigured) {
    return (
      <p className="notice notice-warning">
        The contracts are not deployed on {TARGET_CHAIN.name} yet. Run <code>npm run deploy:local</code> in
        <code> contracts/</code>, or add the Sepolia addresses to <code>src/config/deployments.json</code>.
      </p>
    );
  }
  return children;
}
