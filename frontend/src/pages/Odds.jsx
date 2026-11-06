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
        <li>A strong attack uses E = 12500 (1.25x); a reverse matchup resists with E = 8000 (0.80x); other matchups use 10000.</li>
        <li>Only the primary element attacks. Multiply both defense elements, then clamp E to 7000–15000. None does not participate.</li>
        <li>Each round both cards attack simultaneously. Base damage is max(1, floor(ATK × E × 100 / (10000 × (100 + enemy DEF)))); passives modify it as described below.</li>
        <li>Choose three different NFTs in order. Each side fights with one active card. A knocked-out card is replaced next round; survivors keep their HP. No damage spills onto the next card.</li>
        <li>Eliminate all three opposing cards to win; both teams eliminated in the same round draw. The entire battle has one 20-round limit.</li>
        <li>At the limit compare Σ(remaining HP / MaxHP) across all three cards. Unused cards count as full HP, knocked-out cards as zero. Fractions are compared exactly; equal sums draw.</li>
        <li>HP, ATK and DEF come directly from the official species stats. Rarity and legacy power do not affect battle; passives do not change the stored base stats.</li>
      </ul>

      <h2>Breeding</h2>
      <ul className="passive-list">
        <li>Every card is ♂ male or ♀ female, at random. Breeding needs one of each, owned by you.</li>
        <li>The child is the species whose breeding rank is closest to the average of its parents' ranks, unless a special recipe applies.</li>
        <li>The parents stay yours but rest afterwards, longer each generation.</li>
      </ul>

      <h2>Passives</h2>
      <p>Each card has at most one passive. Triggers read HP before either attack lands. Apply Pierce to DEF, calculate base damage, apply attack bonuses, then Guard. Round down at each step; final damage is at least 1.</p>
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
            const [rateBp, decompose, enchant, breed] = await Promise.all([
              contract.dropRate(rarity),
              contract.decomposeValue(rarity),
              contract.enchantCost(rarity),
              contract.breedFee(rarity),
            ]);
            return {
              name,
              percent: Number(rateBp) / 100,
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
            <tr><th>Rarity</th><th>Pack chance</th><th>Decompose for</th><th>Enchant</th><th>Breed</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.percent}%</td>
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
            <tr><th>Species</th><th>Elements</th><th>Rarity</th><th>HP / ATK / DEF</th><th>Breeding rank</th></tr>
          </thead>
          <tbody>
            {rows.map((row, id) => {
              const first = ELEMENTS[Number(row.element)];
              const second = ELEMENTS[Number(row.secondElement)];
              return (
                <tr key={SPECIES[id].name} title={SPECIES[id].lore}>
                  <td><img className="species-thumbnail" src={SPECIES[id].image} alt={SPECIES[id].nameEn} loading="lazy" /> {SPECIES[id].name}</td>
                  <td>{second === "None" || first === second ? withIcon(first) : `${withIcon(first)} / ${withIcon(second)}`}</td>
                  <td>{RARITIES[Number(row.rarity)]}</td>
                  <td>{Number(row.maxHP)} / {Number(row.atk)} / {Number(row.def)}</td>
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
