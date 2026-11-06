import { useEffect, useMemo, useState } from "react";
import Card, { CardReveal } from "../components/Card.jsx";
import TxStatus from "../components/TxStatus.jsx";
import WalletGate from "../components/WalletGate.jsx";
import {
  BREED_FEES,
  DECOMPOSE_VALUES,
  ENCHANT_COSTS,
  GENDERS,
  GENDER_SYMBOLS,
  PASSIVES,
  PASSIVE_EFFECTS,
  RARITIES,
  getCardsContract,
} from "../config/contracts.js";
import { RECIPES, SPECIES } from "../config/species.js";
import { useBattles } from "../hooks/useBattles.js";
import { useCoins } from "../hooks/useCoins.jsx";
import { useMyCards } from "../hooks/useMyCards.js";
import { useNow } from "../hooks/useNow.js";
import { useTx } from "../hooks/useTx.js";
import { useWallet } from "../hooks/useWallet.jsx";
import { sideOf } from "../lib/battles.js";
import { findEvent, toCard } from "../lib/cards.js";
import { loadSecret } from "../lib/commitment.js";
import { formatCoins, formatCountdown } from "../lib/format.js";

const LEGENDARY = RARITIES.length - 1;
const MERGE_SIZE = 3;
const IN_BATTLE = "In battle";

const MODES = [
  { id: "merge", label: "Merge", component: MergeMode },
  { id: "enchant", label: "Enchant", component: EnchantMode },
  { id: "decompose", label: "Decompose", component: DecomposeMode },
  { id: "breed", label: "Breed", component: BreedMode },
];

export default function Forge({ onNavigate }) {
  return (
    <section className="panel">
      <h1>Forge</h1>
      <p className="lead">Upgrade your cards, give them passives, turn them back into coins, or breed new ones.</p>
      <WalletGate>
        <Workshop onNavigate={onNavigate} />
      </WalletGate>
    </section>
  );
}

function Workshop({ onNavigate }) {
  const { account } = useWallet();
  const { cards, loading, loaded, error, refresh } = useMyCards();
  const { activeBattles } = useBattles();
  const [modeId, setModeId] = useState("merge");

  // A card committed to a battle must still be owned at the reveal, or the stake is lost.
  const lockedIds = new Set(
    activeBattles.flatMap((battle) => {
      const { iRevealed, myCommitment } = sideOf(battle, account);
      const secret = iRevealed ? null : loadSecret(myCommitment);
      return secret ? secret.tokenIds.map(Number) : [];
    }),
  );

  const Mode = MODES.find((mode) => mode.id === modeId).component;
  return (
    <>
      <div className="mode-tabs" role="group" aria-label="Forge actions">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={mode.id === modeId ? "preset active" : "preset"}
            aria-pressed={mode.id === modeId}
            onClick={() => setModeId(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {error && <p className="notice notice-error">{error}</p>}
      {loaded && cards.length === 0 && !loading ? (
        <div className="notice">
          <p>You have no cards yet.</p>
          <button type="button" onClick={() => onNavigate("shop")}>Go to the shop</button>
        </div>
      ) : (
        <Mode cards={cards} refresh={refresh} lockedIds={lockedIds} onNavigate={onNavigate} />
      )}
    </>
  );
}

/** Weakest first within each rarity, so the obvious material comes first. */
const byRarityThenPower = (a, b) => a.rarity - b.rarity || a.atk - b.atk;

/** A top-up prompt shown when a price is out of reach. */
function CoinCheck({ cost, onNavigate }) {
  const { balance } = useCoins();
  if (cost === null || balance === null || balance >= cost) return null;
  return (
    <div className="notice">
      <p>This costs {formatCoins(cost)}, and you have {formatCoins(balance)}.</p>
      <button type="button" onClick={() => onNavigate("topup")}>Top up</button>
    </div>
  );
}

function useCanAfford(cost) {
  const { balance } = useCoins();
  return cost !== null && (balance === null || balance >= cost);
}

function MergeMode({ cards, refresh, lockedIds }) {
  const { getProvider, getSigner } = useWallet();
  const tx = useTx();
  const [selectedIds, setSelectedIds] = useState([]);
  const [forging, setForging] = useState(false);
  const [forged, setForged] = useState(null);

  const sorted = useMemo(() => [...cards].sort(byRarityThenPower), [cards]);
  // Ignore selected IDs that left the collection (merged, or another account).
  const selected = selectedIds.map((id) => cards.find((card) => card.tokenId === id)).filter(Boolean);
  const rarity = selected[0]?.rarity;
  const ready = selected.length === MERGE_SIZE;

  function canSelect(card) {
    if (card.rarity === LEGENDARY || lockedIds.has(card.tokenId)) return false;
    return selected.length === 0 || (selected.length < MERGE_SIZE && card.rarity === rarity);
  }

  function toggle(card) {
    setForged(null);
    const ids = selected.map((picked) => picked.tokenId);
    setSelectedIds(ids.includes(card.tokenId) ? ids.filter((id) => id !== card.tokenId) : [...ids, card.tokenId]);
  }

  function selectWeakest(rarityToMerge) {
    setForged(null);
    // Enchanted cards go last, because merging loses their passive.
    setSelectedIds(
      sorted
        .filter((card) => card.rarity === rarityToMerge && !lockedIds.has(card.tokenId))
        .sort((a, b) => Number(a.passive > 0) - Number(b.passive > 0))
        .slice(0, MERGE_SIZE)
        .map((card) => card.tokenId),
    );
  }

  async function merge() {
    setForged(null);
    setForging(true);
    try {
      const tokenIds = selected.map((card) => card.tokenId);
      let contract;
      const receipt = await tx.run(
        async () => {
          contract = getCardsContract(await getSigner());
          return contract.merge(tokenIds);
        },
        { pending: "Forging your cards...", success: "Merge complete!" },
      );
      if (!receipt) return;

      setSelectedIds([]);
      // CardsMerged names the new card; its attributes come from getCard.
      const event = findEvent(receipt, contract, "CardsMerged");
      if (event) {
        const { newTokenId } = event.args;
        setForged(toCard(newTokenId, await getCardsContract(getProvider()).getCard(newTokenId)));
      }
      refresh();
    } catch {
      // The merge itself succeeded; the collection below still refreshes.
      refresh();
    } finally {
      setForging(false);
    }
  }

  let hint = "Burn three cards of the same rarity to mint one random card of the next rarity. Merging is free.";
  if (ready) hint = `Ready: three ${RARITIES[rarity]} cards become one ${RARITIES[rarity + 1]} card.`;
  else if (selected.length > 0) {
    const left = MERGE_SIZE - selected.length;
    hint = `Pick ${left} more ${RARITIES[rarity]} card${left > 1 ? "s" : ""}.`;
  }

  return (
    <>
      <div className="forge-bench">
        <div className="forge-inputs">
          {Array.from({ length: MERGE_SIZE }, (_, slot) =>
            selected[slot] ? (
              <div key={selected[slot].tokenId} className="card-slot">
                <Card {...selected[slot]} selected onClick={() => toggle(selected[slot])} />
              </div>
            ) : (
              <div key={`empty-${slot}`} className="card-slot">
                <div className="empty-slot">Card {slot + 1}</div>
              </div>
            ),
          )}
        </div>
        <span className="forge-arrow" aria-hidden="true">→</span>
        <div className="card-slot">
          {forging || forged ? (
            <CardReveal card={forged} shaking={forging} />
          ) : (
            <div className="empty-slot">{ready ? `1 ${RARITIES[rarity + 1]}` : "?"}</div>
          )}
        </div>
      </div>

      <p className="muted">{hint}</p>
      <button type="button" onClick={merge} disabled={!ready || tx.busy}>
        {tx.busy ? "Forging..." : "Merge 3 cards"}
      </button>
      <TxStatus tx={tx} />

      <h2>Your cards</h2>
      <div className="toolbar">
        {[0, 1].map((rarityToMerge) => {
          const count = cards.filter((card) => card.rarity === rarityToMerge && !lockedIds.has(card.tokenId)).length;
          return (
            <button
              key={rarityToMerge}
              type="button"
              className="button-secondary"
              onClick={() => selectWeakest(rarityToMerge)}
              disabled={count < MERGE_SIZE || tx.busy}
            >
              Pick 3 lowest-ATK {RARITIES[rarityToMerge]} ({count})
            </button>
          );
        })}
      </div>
      <div className="card-grid">
        {sorted.map((card) => {
          const isSelected = selected.includes(card);
          return (
            <Card
              key={card.tokenId}
              {...card}
              selected={isSelected}
              disabled={tx.busy || (!isSelected && !canSelect(card))}
              tag={lockedIds.has(card.tokenId) ? IN_BATTLE : undefined}
              onClick={() => toggle(card)}
            />
          );
        })}
      </div>
    </>
  );
}

function EnchantMode({ cards, refresh, lockedIds, onNavigate }) {
  const { getSigner } = useWallet();
  const tx = useTx();
  const [selectedId, setSelectedId] = useState(null);
  const [rolled, setRolled] = useState(null);

  const selected = cards.find((card) => card.tokenId === selectedId);
  const cost = selected ? ENCHANT_COSTS[selected.rarity] : null;
  const canAfford = useCanAfford(cost);
  const currentPassive = selected && selected.passive > 0 ? PASSIVES[selected.passive] : null;

  function pick(card) {
    setRolled(null);
    setSelectedId(card.tokenId);
  }

  async function enchant() {
    setRolled(null);
    let contract;
    const receipt = await tx.run(
      async () => {
        contract = getCardsContract(await getSigner());
        return contract.enchant(selected.tokenId);
      },
      { pending: "Enchanting your card...", success: "Enchant complete!" },
    );
    if (!receipt) return;
    const event = findEvent(receipt, contract, "CardEnchanted");
    if (event) setRolled(PASSIVES[Number(event.args.passive)]);
    refresh();
  }

  return (
    <>
      <p className="muted">
        Pay coins to give a card one random battle passive. Enchanting again replaces the old passive.
        Each of the five is equally likely, including the one you already have. New and bred cards start without a passive.
      </p>
      <ul className="passive-list">
        {Object.entries(PASSIVE_EFFECTS).map(([name, effect]) => (
          <li key={name}><strong>{name}:</strong> {effect}</li>
        ))}
      </ul>

      <div className="action-row">
        <div className="card-slot">
          {selected ? <Card {...selected} /> : <div className="empty-slot">Pick a card</div>}
        </div>
        <div>
          {selected && (
            <p>
              {currentPassive ? `Replaces ${currentPassive}. ` : ""}Costs {formatCoins(cost)}.
            </p>
          )}
          <CoinCheck cost={cost} onNavigate={onNavigate} />
          <button type="button" onClick={enchant} disabled={!selected || !canAfford || tx.busy}>
            {tx.busy ? "Enchanting..." : currentPassive ? "Enchant again" : "Enchant"}
          </button>
          {rolled && <p className="outcome">✨ {rolled}: {PASSIVE_EFFECTS[rolled]}</p>}
        </div>
      </div>
      <TxStatus tx={tx} />

      <CardChoices cards={cards} selectedIds={[selectedId]} busy={tx.busy} lockedIds={lockedIds} onPick={pick} />
    </>
  );
}

function DecomposeMode({ cards, refresh, lockedIds }) {
  const { getSigner } = useWallet();
  const tx = useTx();
  const [selectedId, setSelectedId] = useState(null);

  const selected = cards.find((card) => card.tokenId === selectedId);
  const value = selected ? DECOMPOSE_VALUES[selected.rarity] : null;

  async function decompose() {
    const receipt = await tx.run(
      async () => getCardsContract(await getSigner()).decompose(selected.tokenId),
      { pending: "Decomposing your card...", success: `Card decomposed. You received ${formatCoins(value)}.` },
    );
    if (!receipt) return;
    setSelectedId(null);
    refresh();
  }

  return (
    <>
      <p className="muted">
        Burn a card for coins: {RARITIES.map((name, rarity) => `${name} ${formatCoins(DECOMPOSE_VALUES[rarity])}`).join(", ")}.
        That is less than a card costs to get, and any passive on it is lost.
      </p>

      <div className="action-row">
        <div className="card-slot">
          {selected ? <Card {...selected} /> : <div className="empty-slot">Pick a card</div>}
        </div>
        <div>
          {selected && <p>This burns card #{selected.tokenId} for good.</p>}
          <button type="button" onClick={decompose} disabled={!selected || tx.busy}>
            {tx.busy ? "Decomposing..." : selected ? `Decompose for ${formatCoins(value)}` : "Decompose"}
          </button>
        </div>
      </div>
      <TxStatus tx={tx} />

      <CardChoices
        cards={cards}
        selectedIds={[selectedId]}
        busy={tx.busy}
        lockedIds={lockedIds}
        lockSelection
        onPick={(card) => setSelectedId(card.tokenId)}
      />
    </>
  );
}

function BreedMode({ cards, refresh, lockedIds, onNavigate }) {
  const { getProvider, getSigner } = useWallet();
  const tx = useTx();
  const now = useNow();
  // Both indexed by gender: the token ID picked for each slot, and the slot being filled.
  const [pickedIds, setPickedIds] = useState([null, null]);
  const [activeGender, setActiveGender] = useState(null);
  const [childPreview, setChildPreview] = useState(null);
  const [breeding, setBreeding] = useState(false);
  const [born, setBorn] = useState(null);

  // Ignore a picked ID that left the collection (merged, or another account).
  const parents = pickedIds.map((id) => cards.find((card) => card.tokenId === id) ?? null);
  const [male, female] = parents;
  const fee = childPreview ? BREED_FEES[childPreview.rarity] : null;
  const canAfford = useCanAfford(fee);
  const maleSpecies = male?.speciesId;
  const femaleSpecies = female?.speciesId;

  // The contract works out the child, so the formula lives in one place.
  useEffect(() => {
    setChildPreview(null);
    if (maleSpecies === undefined || femaleSpecies === undefined) return undefined;
    let stale = false;
    (async () => {
      const contract = getCardsContract(getProvider());
      const speciesId = Number(await contract.breedResult(maleSpecies, femaleSpecies));
      const species = await contract.getSpecies(speciesId);
      if (!stale) setChildPreview({ speciesId, rarity: Number(species.rarity) });
    })().catch(() => {});
    return () => {
      stale = true;
    };
  }, [maleSpecies, femaleSpecies, getProvider]);

  const isResting = (card) => card.breedReadyAt > now;

  function chooseSlot(gender) {
    setBorn(null);
    setActiveGender(gender);
  }

  function pick(card) {
    setBorn(null);
    const next = parents.map((parent) => parent?.tokenId ?? null);
    const deselecting = next[card.gender] === card.tokenId;
    next[card.gender] = deselecting ? null : card.tokenId;
    setPickedIds(next);
    // After a pick, move on to the other slot if it is still empty.
    const otherGender = 1 - card.gender;
    setActiveGender(deselecting || next[otherGender] !== null ? card.gender : otherGender);
  }

  async function breed() {
    setBorn(null);
    setBreeding(true);
    try {
      let contract;
      const receipt = await tx.run(
        async () => {
          contract = getCardsContract(await getSigner());
          return contract.breed(male.tokenId, female.tokenId);
        },
        { pending: "Breeding...", success: "A new card was born!" },
      );
      if (!receipt) return;

      setPickedIds([null, null]);
      setActiveGender(null);
      const event = findEvent(receipt, contract, "CardBred");
      if (event) {
        const { childId } = event.args;
        setBorn(toCard(childId, await getCardsContract(getProvider()).getCard(childId)));
      }
      refresh();
    } catch {
      // The breeding itself succeeded; the collection below still refreshes.
      refresh();
    } finally {
      setBreeding(false);
    }
  }

  const resting = parents.filter((parent) => parent && isResting(parent));
  const missingGenders = GENDERS.filter((_, gender) => !cards.some((card) => card.gender === gender));

  let hint = "Click the Male or Female slot, then pick a card of that gender.";
  if (activeGender !== null) {
    hint = `Choosing a ${GENDERS[activeGender].toLowerCase()} parent. Click the other slot to switch.`;
  }

  return (
    <>
      <p className="muted">
        A male and a female breed the species whose breeding rank is closest to the average of theirs.
        The parents stay yours but rest afterwards, longer each generation. New cards have no passive.
      </p>
      <p className="muted">
        Special recipes:{" "}
        {RECIPES.map(({ parents: pair, child }) => `${SPECIES[pair[0]].name} + ${SPECIES[pair[1]].name} → ${SPECIES[child].name}`).join("; ")}.
      </p>

      <div className="forge-bench">
        <div className="forge-inputs">
          {GENDERS.map((name, gender) => (
            <GenderSlot
              key={name}
              gender={gender}
              card={parents[gender]}
              active={activeGender === gender}
              onChoose={() => chooseSlot(gender)}
            />
          ))}
        </div>
        <span className="forge-arrow" aria-hidden="true">→</span>
        <div className="card-slot">
          {breeding || born ? (
            <CardReveal card={born} shaking={breeding} />
          ) : (
            <div className="empty-slot">
              {childPreview ? `${SPECIES[childPreview.speciesId].name} (${RARITIES[childPreview.rarity]})` : "?"}
            </div>
          )}
        </div>
      </div>

      <p className="muted" role="status">{hint}</p>
      {missingGenders.length > 0 && (
        <p className="field-error">
          You have no {missingGenders.join(" or ").toLowerCase()} cards yet, so you cannot breed. Open more packs.
        </p>
      )}
      {fee !== null && <p>Fee: {formatCoins(fee)}.</p>}
      {resting.map((card) => (
        <p key={card.tokenId} className="field-error">
          Card #{card.tokenId} is resting for {formatCountdown(card.breedReadyAt - now)}.
        </p>
      ))}
      <CoinCheck cost={fee} onNavigate={onNavigate} />
      <button
        type="button"
        onClick={breed}
        disabled={!male || !female || !childPreview || !canAfford || resting.length > 0 || tx.busy}
      >
        {tx.busy ? "Breeding..." : "Breed"}
      </button>
      <TxStatus tx={tx} />

      <CardChoices
        cards={cards}
        selectedIds={pickedIds}
        busy={tx.busy}
        lockedIds={lockedIds}
        isSelectable={(card) => activeGender === null || card.gender === activeGender}
        restingTag={(card) => (isResting(card) ? `Rests ${formatCountdown(card.breedReadyAt - now)}` : undefined)}
        onPick={pick}
      />
    </>
  );
}

/** One parent slot. Clicking it, or its card, makes this the gender being chosen. */
function GenderSlot({ gender, card, active, onChoose }) {
  const name = GENDERS[gender];
  return (
    <div className="gender-slot">
      <button
        type="button"
        className={active ? "preset active" : "preset"}
        aria-pressed={active}
        onClick={onChoose}
      >
        <span className={active ? "" : `gender-${name.toLowerCase()}`} aria-hidden="true">{GENDER_SYMBOLS[gender]}</span> {name}
      </button>
      <div className="card-slot">
        {card ? (
          <Card {...card} selected={active} onClick={onChoose} />
        ) : (
          <button type="button" className={active ? "empty-slot active" : "empty-slot"} onClick={onChoose}>
            Choose a {name.toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The selectable grid for the Enchant, Decompose and Breed tabs. With lockSelection,
 * a card committed to a battle cannot be picked; otherwise it is only tagged.
 * Cards that fail isSelectable are greyed out and cannot be picked.
 */
function CardChoices({ cards, selectedIds, busy, lockedIds, lockSelection = false, isSelectable, restingTag, onPick }) {
  const sorted = useMemo(() => [...cards].sort(byRarityThenPower), [cards]);
  return (
    <>
      <h2>Your cards</h2>
      <div className="card-grid">
        {sorted.map((card) => {
          const isSelected = selectedIds.includes(card.tokenId);
          const locked = lockedIds.has(card.tokenId);
          return (
            <Card
              key={card.tokenId}
              {...card}
              selected={isSelected}
              disabled={busy || (lockSelection && locked) || (isSelectable && !isSelectable(card))}
              tag={locked ? IN_BATTLE : restingTag?.(card)}
              onClick={() => onPick(card)}
            />
          );
        })}
      </div>
    </>
  );
}
