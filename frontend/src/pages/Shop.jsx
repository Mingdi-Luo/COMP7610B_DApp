import { useState } from "react";
import { formatEther, parseEther } from "ethers";
import { CardReveal } from "../components/Card.jsx";
import TxStatus from "../components/TxStatus.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { ELEMENTS, RARITIES, getCardsContract } from "../config/contracts.js";
import { useTx } from "../hooks/useTx.js";
import { useWallet } from "../hooks/useWallet.jsx";
import { findEvent, toCard } from "../lib/cards.js";

// Mirrors ElementCards.PACK_PRICE.
const PACK_PRICE = parseEther("0.001");

/** Reference page for the send -> wait -> parse-event pattern. */
export default function Shop({ onNavigate }) {
  const { getSigner } = useWallet();
  const tx = useTx();
  const [opening, setOpening] = useState(false);
  const [newCard, setNewCard] = useState(null);

  async function openPack() {
    setNewCard(null);
    setOpening(true);
    let contract;
    // Getting the signer inside run() lets useTx report a rejected network switch too.
    const receipt = await tx.run(
      async () => {
        contract = getCardsContract(await getSigner());
        return contract.openPack({ value: PACK_PRICE });
      },
      { pending: "Opening your pack...", success: "Pack opened!" },
    );

    // The PackOpened event in the receipt says which card was minted.
    const event = receipt && findEvent(receipt, contract, "PackOpened");
    setOpening(false);
    if (event) setNewCard(toCard(event.args.tokenId, event.args));
  }

  return (
    <section className="panel">
      <h1>Shop</h1>
      <p className="lead">
        One pack mints one random card for {formatEther(PACK_PRICE)} ETH. The card is an NFT owned by
        your wallet.
      </p>

      <WalletGate>
        <div className="pack-stage">
          <CardReveal card={newCard} shaking={opening} />
          {newCard && (
            <p className={`reveal-caption rarity-${RARITIES[newCard.rarity].toLowerCase()}`}>
              {RARITIES[newCard.rarity]} {ELEMENTS[newCard.element]} card #{newCard.tokenId}, power {newCard.power}
            </p>
          )}
        </div>

        <div className="toolbar">
          <button type="button" onClick={openPack} disabled={tx.busy}>
            {tx.busy ? "Opening..." : newCard ? "Open another pack" : "Open a pack"}
          </button>
          {newCard && (
            <button type="button" className="button-secondary" onClick={() => onNavigate("collection")}>
              See my cards
            </button>
          )}
        </div>
        <TxStatus tx={tx} />
      </WalletGate>
    </section>
  );
}
