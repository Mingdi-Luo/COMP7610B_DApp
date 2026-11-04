import { useEffect, useState } from "react";
import { addressUrl } from "../config/chains.js";
import { CARDS_ADDRESS, ELEMENTS, PASSIVE_EFFECTS, RARITIES, getCardsContract } from "../config/contracts.js";
import { ELEMENT_ICONS, SPECIES } from "../config/species.js";
import WalletGate from "../components/WalletGate.jsx";
import { useWallet } from "../hooks/useWallet.jsx";
import { readableError } from "../lib/errors.js";
import { formatCoins } from "../lib/format.js";

// Mirrors Arena.beats.
const STRENGTHS = [
  ["Water", ["Fire"]],
  ["Fire", ["Grass", "Ice"]],
  ["Grass", ["Ground"]],
  ["Ground", ["Electric"]],
  ["Electric", ["Water"]],
  ["Ice", ["Dragon"]],
  ["Dragon", ["Dark"]],
  ["Dark", ["Neutral"]],
];

const withIcon = (name) => `${ELEMENT_ICONS[name]} ${name}`;

export default function Odds() {
  return (
    <section className="panel">
      <h1>Rules</h1>
      <p className="lead">
        Prices, odds and species are read straight from the smart contract. Nobody, including us, can
        change them after deployment.
      </p>
      <WalletGate>
        <PriceTable />
      </WalletGate>

      <h2>Element chart</h2>
      <ul className="passive-list">
        {STRENGTHS.map(([attacker, targets]) => (
          <li key={attacker}>{withIcon(attacker)} is strong against {targets.map(withIcon).join(" and ")}</li>
        ))}
      </ul>
      <ul className="passive-list">
        <li>A strong attack deals 2x power. A resisted attack deals 0.5x.</li>
        <li>A card attacks with its first element. Against a dual-element card, both results multiply: two strengths make 4x, a strength and a resistance make 1x.</li>
        <li>An element attacks itself at 1x.</li>
        <li>{withIcon("Neutral")} always attacks at 1x and is strong against nothing, but {withIcon("Dark")} is strong against it.</li>
      </ul>

      <h2>Breeding</h2>
      <ul className="passive-list">
        <li>Every card is ♂ male or ♀ female, at random. Breeding needs one of each, owned by you.</li>
        <li>The child is the species whose breeding rank is closest to the average of its parents' ranks, unless a special recipe applies.</li>
        <li>The parents stay yours but rest afterwards, longer each generation.</li>
      </ul>

      <h2>Passives</h2>
      <ul className="passive-list">
        {Object.entries(PASSIVE_EFFECTS).map(([name, effect]) => (
          <li key={name}><strong>{name}:</strong> {effect}</li>
        ))}
      </ul>

      <WalletGate>
        <SpeciesTable />
      </WalletGate>
    </section>
  );
}

function PriceTable() {
  const { getProvider } = useWallet();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const contract = getCardsContract(getProvider());
        const loaded = await Promise.all(
          RARITIES.map(async (name, rarity) => {
            const [rateBp, [minPower, maxPower], decompose, enchant, breed] = await Promise.all([
              contract.dropRate(rarity),
              contract.powerRange(rarity),
              contract.decomposeValue(rarity),
              contract.enchantCost(rarity),
              contract.breedFee(rarity),
            ]);
            return {
              name,
              percent: Number(rateBp) / 100,
              minPower: Number(minPower),
              maxPower: Number(maxPower),
              decompose,
              enchant,
              breed,
            };
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
      <div className="table-scroll">
        <table className="odds-table">
          <thead>
            <tr><th>Rarity</th><th>Pack chance</th><th>Power</th><th>Decompose for</th><th>Enchant</th><th>Breed</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.percent}%</td>
                <td>{row.minPower}–{row.maxPower}</td>
                <td>{formatCoins(row.decompose)}</td>
                <td>{formatCoins(row.enchant)}</td>
                <td>{formatCoins(row.breed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function SpeciesTable() {
  const { getProvider } = useWallet();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const contract = getCardsContract(getProvider());
        const count = Number(await contract.speciesCount());
        const species = await Promise.all(Array.from({ length: count }, (_, id) => contract.getSpecies(id)));
        setRows(species);
      } catch (err) {
        setError(readableError(err));
      }
    }
    load();
  }, [getProvider]);

  return (
    <>
      <h2>All {SPECIES.length} species</h2>
      {error && <p className="notice notice-error">{error}</p>}
      <div className="table-scroll">
        <table className="odds-table">
          <thead>
            <tr><th>Species</th><th>Elements</th><th>Rarity</th><th>Base power</th><th>Breeding rank</th></tr>
          </thead>
          <tbody>
            {rows.map((row, id) => {
              const first = ELEMENTS[Number(row.element)];
              const second = ELEMENTS[Number(row.secondElement)];
              return (
                <tr key={SPECIES[id].name} title={SPECIES[id].lore}>
                  <td><span aria-hidden="true">{SPECIES[id].icon}</span> {SPECIES[id].name}</td>
                  <td>{first === second ? withIcon(first) : `${withIcon(first)} / ${withIcon(second)}`}</td>
                  <td>{RARITIES[Number(row.rarity)]}</td>
                  <td>{Number(row.basePower)}</td>
                  <td>{Number(row.breedRank)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
