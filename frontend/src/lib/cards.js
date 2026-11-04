/** Plain numbers from a contract Card (bigints). */
export function toCard(tokenId, card) {
  return {
    tokenId: Number(tokenId),
    speciesId: Number(card.speciesId),
    element: Number(card.element),
    secondElement: Number(card.secondElement),
    rarity: Number(card.rarity),
    power: Number(card.power),
    passive: Number(card.passive),
    gender: Number(card.gender),
    generation: Number(card.generation),
    breedReadyAt: Number(card.breedReadyAt),
  };
}

/**
 * The first `name` event that `contract` emitted in a transaction receipt, or undefined.
 * Other contracts' logs are skipped: GameCoin's Transfer has the same topic as the card's,
 * but cannot be decoded with the card's ABI.
 */
export function findEvent(receipt, contract, name) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== String(contract.target).toLowerCase()) continue;
    const parsed = contract.interface.parseLog(log);
    if (parsed?.name === name) return parsed;
  }
  return undefined;
}

// The rest of this file mirrors Arena.sol, so results can be explained without extra RPC calls.
const NEUTRAL = 0;
const PIERCE = 1;
const UNDERDOG = 2;
const RESONANCE = 3;
const GUARD = 4;
const FOCUS = 5;

// Elements each element is strong against, indexed in contract order
// (Neutral, Fire, Water, Grass, Electric, Ground, Ice, Dragon, Dark).
const STRONG_AGAINST = [[], [3, 6], [1], [5], [2], [4], [7], [8], [0]];

const beats = (attacker, defender) => STRONG_AGAINST[attacker].includes(defender);

function elementMultiplier(attacker, defender) {
  if (attacker === NEUTRAL) return 100;
  if (beats(attacker, defender)) return 200;
  if (beats(defender, attacker)) return 50;
  return 100;
}

function attackMultiplier(attacker, defender) {
  const first = elementMultiplier(attacker.element, defender.element);
  if (defender.secondElement === defender.element) return first;
  return (first * elementMultiplier(attacker.element, defender.secondElement)) / 100;
}

const shareElement = (a, b) =>
  a.element === b.element ||
  a.element === b.secondElement ||
  a.secondElement === b.element ||
  a.secondElement === b.secondElement;

/**
 * How a card's battle power is worked out against an enemy:
 * { multiplier, bonus, total }, with multiplier and bonus in percent.
 */
export function battleBreakdown(card, enemy) {
  let multiplier = attackMultiplier(card, enemy);
  let bonus = 0;
  if (card.passive === PIERCE && multiplier < 100) multiplier = 100;
  else if (card.passive === UNDERDOG && card.power < enemy.power) bonus = 30;
  else if (card.passive === RESONANCE && shareElement(card, enemy)) bonus = 20;
  else if (card.passive === GUARD && attackMultiplier(enemy, card) > 100) bonus = 25;
  else if (card.passive === FOCUS) bonus = 10;
  return { multiplier, bonus, total: Math.floor((card.power * multiplier * (100 + bonus)) / 10_000) };
}
