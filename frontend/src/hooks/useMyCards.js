import { useCallback, useEffect, useState } from "react";
import { contractsConfigured, getCardsContract } from "../config/contracts.js";
import { toCard } from "../lib/cards.js";
import { readableError } from "../lib/errors.js";
import { useWallet } from "./useWallet.jsx";

/**
 * Cards owned by the connected wallet, as plain objects:
 * { tokenId, speciesId, element, rarity, maxHP, atk, def } (all numbers; enums use contracts.js order).
 * Call refresh() after a transaction that changes the collection. `loaded` turns
 * true after the first load, so pages can tell "no cards" from "not loaded yet".
 */
export function useMyCards() {
  const { account, isCorrectChain, getProvider } = useWallet();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    if (!account || !isCorrectChain || !contractsConfigured) {
      setCards([]);
      return;
    }

    setLoading(true);
    try {
      const contract = getCardsContract(getProvider());
      const tokenIds = await contract.cardsOf(account);
      const owned = await Promise.all(
        tokenIds.map(async (tokenId) => toCard(tokenId, await contract.getCard(tokenId))),
      );
      setCards(owned);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [account, isCorrectChain, getProvider]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cards, loading, loaded, error, refresh };
}
