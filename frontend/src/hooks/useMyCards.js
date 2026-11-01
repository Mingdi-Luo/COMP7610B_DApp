import { useCallback, useEffect, useState } from "react";
import { contractsConfigured, getCardsContract } from "../config/contracts.js";
import { readableError } from "../lib/errors.js";
import { useWallet } from "./useWallet.jsx";

/**
 * Cards owned by the connected wallet, as plain objects:
 * { tokenId, element, rarity, power } (all numbers; enums use contracts.js order).
 * Call refresh() after a transaction that changes the collection.
 */
export function useMyCards() {
  const { account, isCorrectChain, getProvider } = useWallet();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
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
      const loaded = await Promise.all(
        tokenIds.map(async (tokenId) => {
          const card = await contract.getCard(tokenId);
          return {
            tokenId: Number(tokenId),
            element: Number(card.element),
            rarity: Number(card.rarity),
            power: Number(card.power),
          };
        }),
      );
      setCards(loaded);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setLoading(false);
    }
  }, [account, isCorrectChain, getProvider]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cards, loading, error, refresh };
}
