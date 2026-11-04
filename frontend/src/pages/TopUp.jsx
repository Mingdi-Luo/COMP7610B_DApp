import { useState } from "react";
import TxStatus from "../components/TxStatus.jsx";
import WalletGate from "../components/WalletGate.jsx";
import { getCoinContract } from "../config/contracts.js";
import { useCoins } from "../hooks/useCoins.jsx";
import { useTx } from "../hooks/useTx.js";
import { useWallet } from "../hooks/useWallet.jsx";
import { formatCoins, formatEth } from "../lib/format.js";

// Mirrors GameCoin.WEI_PER_COIN: 1 ETH buys 1,000,000 coins.
const WEI_PER_COIN = 10n ** 12n;
const PRESETS = [1_000n, 5_000n, 10_000n, 50_000n];

export default function TopUp({ onNavigate }) {
  return (
    <section className="panel">
      <h1>Top up</h1>
      <p className="lead">
        Everything in the game costs Duel Coin (DUEL): packs, enchants, breeding and battle stakes.
        Buy coins with ETH at a fixed rate of 1 ETH = 1,000,000 DUEL.
      </p>
      <WalletGate>
        <TopUpForm onNavigate={onNavigate} />
      </WalletGate>
    </section>
  );
}

function TopUpForm({ onNavigate }) {
  const { getSigner } = useWallet();
  const { balance } = useCoins();
  const tx = useTx();
  const [amountInput, setAmountInput] = useState("1000");

  const coins = parseCoins(amountInput);

  async function topUp() {
    await tx.run(
      async () => getCoinContract(await getSigner()).topUp({ value: coins * WEI_PER_COIN }),
      { pending: "Buying your coins...", success: `Added ${formatCoins(coins)} to your balance.` },
    );
  }

  return (
    <>
      <div className="stat topup-balance">
        <span className="stat-label">Your balance</span>
        <strong className="stat-value">{balance === null ? "…" : formatCoins(balance)}</strong>
      </div>

      <h2>Choose an amount</h2>
      <div className="toolbar">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={coins === preset ? "preset active" : "preset"}
            aria-pressed={coins === preset}
            onClick={() => setAmountInput(String(preset))}
          >
            {preset.toLocaleString("en-US")}
          </button>
        ))}
      </div>

      <div className="create-battle">
        <label className="field">
          <span>Coins to buy</span>
          <input
            type="text"
            inputMode="numeric"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            aria-invalid={coins === null}
          />
        </label>
        <button type="button" onClick={topUp} disabled={coins === null || tx.busy}>
          {tx.busy ? "Topping up..." : coins === null ? "Top up" : `Pay ${formatEth(coins * WEI_PER_COIN)}`}
        </button>
      </div>
      {coins === null && <p className="field-error">Enter a whole number of coins, 1 or more.</p>}

      <TxStatus tx={tx} />
      {tx.phase === "success" && (
        <button type="button" className="button-secondary spaced" onClick={() => onNavigate("shop")}>
          Go to the shop
        </button>
      )}

      <p className="muted">
        Top-ups are one-way: coins cannot be turned back into ETH. A pack costs 1,000 DUEL, so 0.001 ETH
        buys one pack. MetaMask also charges a small gas fee.
      </p>
    </>
  );
}

/** The amount as a bigint, or null unless the input is a whole number of 1 or more. */
function parseCoins(text) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const coins = BigInt(trimmed);
  return coins > 0n ? coins : null;
}
