import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider } from "ethers";
import { TARGET_CHAIN, TARGET_CHAIN_ID } from "../config/chains.js";
import { readableError } from "../lib/errors.js";

const WalletContext = createContext(null);

/** Shares the MetaMask connection with every page. Wrap the app in it once. */
export function WalletProvider({ children }) {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [error, setError] = useState("");

  // MetaMask injects window.ethereum, an EIP-1193 provider, into the page.
  const hasWallet = typeof window !== "undefined" && Boolean(window.ethereum);

  useEffect(() => {
    if (!hasWallet) return undefined;

    // eth_accounts restores an earlier connection without opening a MetaMask popup.
    window.ethereum.request({ method: "eth_accounts" }).then((accounts) => setAccount(accounts[0] ?? ""));
    window.ethereum.request({ method: "eth_chainId" }).then((id) => setChainId(Number(id)));

    // Keep the interface accurate when the user changes account or network in MetaMask.
    const onAccountsChanged = (accounts) => setAccount(accounts[0] ?? "");
    const onChainChanged = (id) => setChainId(Number(id));
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);

    // Removing listeners prevents duplicate handlers after React remounts the component.
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged", onChainChanged);
    };
  }, [hasWallet]);

  const switchToTargetChain = useCallback(async () => {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: TARGET_CHAIN.chainIdHex }],
      });
    } catch (switchError) {
      // 4902 means MetaMask does not know the chain yet, e.g. the local Hardhat node.
      if (switchError?.code !== 4902 || !TARGET_CHAIN.rpcUrl) throw switchError;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: TARGET_CHAIN.chainIdHex,
            chainName: TARGET_CHAIN.name,
            rpcUrls: [TARGET_CHAIN.rpcUrl],
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          },
        ],
      });
    }
  }, []);

  const connect = useCallback(async () => {
    setError("");
    try {
      if (!hasWallet) throw new Error("Install MetaMask to continue");
      // eth_requestAccounts opens MetaMask's account permission prompt.
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      await switchToTargetChain();
      setAccount(accounts[0] ?? "");
    } catch (err) {
      setError(readableError(err));
    }
  }, [hasWallet, switchToTargetChain]);

  // A new BrowserProvider per call avoids ethers caching the old network after a switch.
  // A provider is enough for free, read-only calls; MetaMask does not prompt.
  const getProvider = useCallback(() => {
    if (!hasWallet) throw new Error("Install MetaMask to continue");
    return new BrowserProvider(window.ethereum);
  }, [hasWallet]);

  // A signer represents the connected account and can approve state-changing calls.
  const getSigner = useCallback(async () => {
    if (chainId !== TARGET_CHAIN_ID) await switchToTargetChain();
    return getProvider().getSigner();
  }, [chainId, getProvider, switchToTargetChain]);

  const value = useMemo(
    () => ({
      hasWallet,
      account,
      chainId,
      isCorrectChain: chainId === TARGET_CHAIN_ID,
      error,
      connect,
      switchToTargetChain,
      getProvider,
      getSigner,
    }),
    [hasWallet, account, chainId, error, connect, switchToTargetChain, getProvider, getSigner],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside <WalletProvider>");
  return wallet;
}
