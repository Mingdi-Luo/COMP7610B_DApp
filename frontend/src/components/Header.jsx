import { TARGET_CHAIN } from "../config/chains.js";
import { useCoins } from "../hooks/useCoins.jsx";
import { useWallet } from "../hooks/useWallet.jsx";
import { formatCoins, shortAddress } from "../lib/format.js";

export default function Header({ pages, current, onNavigate }) {
  const { hasWallet, account, isCorrectChain, error, connect, switchToTargetChain } = useWallet();
  const { balance } = useCoins();

  return (
    <header className="header">
      <div className="header-bar">
        <button type="button" className="brand" onClick={() => onNavigate("home")}>
          <span aria-hidden="true">⚔️</span> Cryptids
        </button>

        <div className="wallet-area">
          {balance !== null && (
            <button
              type="button"
              className="coin-chip"
              title="Your game coins. Click to top up."
              onClick={() => onNavigate("topup")}
            >
              <span aria-hidden="true">🪙</span> {formatCoins(balance)}
              <span className="coin-chip-add" aria-hidden="true">+</span>
            </button>
          )}
          {account && !isCorrectChain && (
            <button type="button" className="button-warning" onClick={switchToTargetChain}>
              Switch to {TARGET_CHAIN.name}
            </button>
          )}
          {account ? (
            <span className="wallet-chip" title={account}>
              <span className={isCorrectChain ? "dot dot-ok" : "dot dot-warn"} aria-hidden="true" />
              {shortAddress(account)}
            </span>
          ) : (
            <button type="button" onClick={connect} disabled={!hasWallet}>
              {hasWallet ? "Connect MetaMask" : "MetaMask not found"}
            </button>
          )}
        </div>
      </div>

      <nav className="nav" aria-label="Pages">
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            className={page.id === current ? "nav-link active" : "nav-link"}
            aria-current={page.id === current ? "page" : undefined}
            onClick={() => onNavigate(page.id)}
          >
            {page.label}
          </button>
        ))}
      </nav>

      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </header>
  );
}
