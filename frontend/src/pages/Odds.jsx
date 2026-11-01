import { useEffect, useState } from "react";
import { addressUrl } from "../config/chains.js";
import { CARDS_ADDRESS, RARITIES, getCardsContract } from "../config/contracts.js";
import WalletGate from "../components/WalletGate.jsx";
import { useWallet } from "../hooks/useWallet.jsx";
import { readableError } from "../lib/errors.js";

// TODO(frontend A): turn the table into a visual (bars or a pie) and explain why on-chain odds matter.
export default function Odds() {
  return (
    <section className="panel">
      <h1>Drop rates</h1>
      <p className="lead">
        These numbers are read straight from the smart contract. Nobody, including us, can change
        them after deployment.
      </p>
      <WalletGate>
        <OddsTable />
      </WalletGate>
    </section>
  );
}

function OddsTable() {
  const { getProvider } = useWallet();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const contract = getCardsContract(getProvider());
        const loaded = await Promise.all(
          RARITIES.map(async (name, rarity) => {
            const [rateBp, [minPower, maxPower]] = await Promise.all([
              contract.dropRate(rarity),
              contract.powerRange(rarity),
            ]);
            return { name, percent: Number(rateBp) / 100, minPower: Number(minPower), maxPower: Number(maxPower) };
          }),
        );
        setRows(loaded);
      } catch (err) {
        setError(readableError(err));
      }
    }
    load();
  }, [getProvider]);

  const contractLink = addressUrl(CARDS_ADDRESS);

  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}
      <table className="odds-table">
        <thead>
          <tr><th>Rarity</th><th>Chance</th><th>Power</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.percent}%</td>
              <td>{row.minPower}–{row.maxPower}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Contract:{" "}
        {contractLink ? (
          <a href={contractLink} target="_blank" rel="noreferrer">{CARDS_ADDRESS} ↗</a>
        ) : (
          <code>{CARDS_ADDRESS}</code>
        )}
      </p>
    </>
  );
}
