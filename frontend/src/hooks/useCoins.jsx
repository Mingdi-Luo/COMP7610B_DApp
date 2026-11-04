import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { contractsConfigured, getCoinContract } from "../config/contracts.js";
import { useWallet } from "./useWallet.jsx";

const CoinContext = createContext(null);
const POLL_MS = 10_000;

/**
 * Shares the connected player's coin balance (a bigint, or null when unknown) with every
 * page. It polls because an opponent's reveal can pay this player without any local action.
 */
export function CoinProvider({ children }) {
  const { account, isCorrectChain, getProvider } = useWallet();
  const [balance, setBalance] = useState(null);
  // Ignores a slow response that an account switch has already replaced.
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    if (!account || !isCorrectChain || !contractsConfigured) {
      setBalance(null);
      return;
    }
    try {
      const coins = await getCoinContract(getProvider()).balanceOf(account);
      if (request === latestRequest.current) setBalance(coins);
    } catch {
      // Keep the last known balance; the next poll tries again.
    }
  }, [account, isCorrectChain, getProvider]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo(() => ({ balance, refresh }), [balance, refresh]);
  return <CoinContext.Provider value={value}>{children}</CoinContext.Provider>;
}

export function useCoins() {
  const coins = useContext(CoinContext);
  if (!coins) throw new Error("useCoins must be used inside <CoinProvider>");
  return coins;
}
