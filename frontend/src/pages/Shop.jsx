import { useState } from "react";
import { CardReveal } from "../components/Card.jsx";
import TxStatus from "../components/TxStatus.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { ELEMENTS, GENDERS, PACK_PRICE, RARITIES, getCardsContract } from "../config/contracts.js";
import { SPECIES } from "../config/species.js";
import { useCoins } from "../hooks/useCoins.jsx";
import { useTx } from "../hooks/useTx.js";
import { useWallet } from "../hooks/useWallet.jsx";
import { findEvent, toCard } from "../lib/cards.js";
import { formatCoins } from "../lib/format.js";

/** Reference page for the send -> wait -> parse-event pattern. */
export default function Shop({ onNavigate }) {
  return (
    <section className="panel">
      <h1>Shop</h1>
      <p className="lead">
        One pack mints one random creature card for {formatCoins(PACK_PRICE)}. The card is an NFT owned
        by your wallet.
      </p>
      <WalletGate>
        <PackCounter onNavigate={onNavigate} />
      </WalletGate>
    </section>
  );
}

function PackCounter({ onNavigate }) {
  const { getProvider, getSigner } = useWallet();
  const { balance } = useCoins();
  const tx = useTx();
  const [opening, setOpening] = useState(false);
  const [newCard, setNewCard] = useState(null);
  const tooFewCoins = balance !== null && balance < PACK_PRICE;

  async function openPack() {
    setNewCard(null);
    setOpening(true);
    try {
      let contract;
      // Getting the signer inside run() lets useTx report a rejected network switch too.
      const receipt = await tx.run(
        async () => {
          contract = getCardsContract(await getSigner());
          return contract.openPack();
        },
        { pending: "Opening your pack...", success: "Pack opened!" },
      );

      // The PackOpened event names the new card; its full attributes come from getCard.
      const event = receipt && findEvent(receipt, contract, "PackOpened");
      if (event) {
        const { tokenId } = event.args;
        setNewCard(toCard(tokenId, await getCardsContract(getProvider()).getCard(tokenId)));
      }
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <div className="pack-stage">
        <CardReveal card={newCard} shaking={opening} />
        {newCard && (
          <p className={`reveal-caption rarity-${RARITIES[newCard.rarity].toLowerCase()}`}>
            {RARITIES[newCard.rarity]} {SPECIES[newCard.speciesId].name}, {GENDERS[newCard.gender]}, {ELEMENTS[newCard.element]}, power {newCard.power}
          </p>
        )}
      </div>

      {tooFewCoins && (
        <div className="notice">
          <p>You need {formatCoins(PACK_PRICE)} to open a pack.</p>
          <button type="button" onClick={() => onNavigate("topup")}>Top up</button>
        </div>
      )}

      <div className="toolbar">
        <button type="button" onClick={openPack} disabled={tx.busy || tooFewCoins}>
          {tx.busy ? "Opening..." : newCard ? "Open another pack" : "Open a pack"}
        </button>
        {newCard && (
          <button type="button" className="button-secondary" onClick={() => onNavigate("collection")}>
            See my cards
          </button>
        )}
      </div>
      <TxStatus tx={tx} />
    </>
  );
}
