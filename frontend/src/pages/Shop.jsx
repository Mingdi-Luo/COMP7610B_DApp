import { useState } from "react";
import { formatEther, parseEther } from "ethers";
import Card from "../components/Card.jsx";
import TxStatus from "../components/TxStatus.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { getCardsContract } from "../config/contracts.js";
import { useTx } from "../hooks/useTx.js";
import { useWallet } from "../hooks/useWallet.jsx";

// Mirrors ElementCards.PACK_PRICE.
const PACK_PRICE = parseEther("0.001");

/**
 * Reference page for the read -> send -> wait -> parse-event pattern.
 * TODO(frontend A): pack-opening animation (card back flips to reveal the card).
 */
export default function Shop() {
  const { getSigner } = useWallet();
  const tx = useTx();
  const [newCard, setNewCard] = useState(null);

  async function openPack() {
    setNewCard(null);
    let contract;
    // Getting the signer inside run() lets useTx report a rejected network switch too.
    const receipt = await tx.run(
      async () => {
        contract = getCardsContract(await getSigner());
        return contract.openPack({ value: PACK_PRICE });
      },
      { pending: "Opening your pack...", success: "Pack opened!" },
    );
    if (!receipt) return;

    // The PackOpened event in the receipt says which card was minted.
    const event = receipt.logs
      .map((log) => contract.interface.parseLog(log))
      .find((parsed) => parsed?.name === "PackOpened");
    if (event) {
      const { tokenId, element, rarity, power } = event.args;
      setNewCard({ tokenId: Number(tokenId), element: Number(element), rarity: Number(rarity), power: Number(power) });
    }
  }

  return (
    <section className="panel">
      <h1>Shop</h1>
      <p className="lead">One pack mints one random card for {formatEther(PACK_PRICE)} ETH.</p>

      <WalletGate>
        <button type="button" onClick={openPack} disabled={tx.busy}>
          {tx.busy ? "Opening..." : "Open a pack"}
        </button>
        <TxStatus tx={tx} />
        {newCard && (
          <div className="reveal">
            <p>You got:</p>
            <Card {...newCard} />
          </div>
        )}
      </WalletGate>
    </section>
  );
}
