/**
 * Networks the DApp can run on. VITE_CHAIN_ID in frontend/.env picks one;
 * without it the DApp uses the local Hardhat node.
 */
export const CHAINS = {
  31337: {
    name: "Hardhat Local",
    chainIdHex: "0x7a69",
    // MetaMask does not know the local node, so the DApp offers to add it.
    rpcUrl: "http://127.0.0.1:8545",
    explorerUrl: "",
  },
  11155111: {
    name: "Sepolia",
    // MetaMask uses hexadecimal chain IDs. 0xaa36a7 equals 11155111.
    chainIdHex: "0xaa36a7",
    rpcUrl: "",
    explorerUrl: "https://sepolia.etherscan.io",
  },
};

export const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 31337);
export const TARGET_CHAIN = CHAINS[TARGET_CHAIN_ID];

/** Block explorer link for a transaction, or "" on the local chain. */
export function txUrl(hash) {
  return TARGET_CHAIN.explorerUrl && hash ? `${TARGET_CHAIN.explorerUrl}/tx/${hash}` : "";
}

/** Block explorer link for a contract or wallet address, or "" on the local chain. */
export function addressUrl(address) {
  return TARGET_CHAIN.explorerUrl && address ? `${TARGET_CHAIN.explorerUrl}/address/${address}` : "";
}
