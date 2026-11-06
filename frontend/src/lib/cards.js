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
    maxHP: Number(card.maxHP),
    atk: Number(card.atk),
    def: Number(card.def),
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
const NONE = 9;
const PASSIVE = { Pierce: 1, Underdog: 2, Resonance: 3, Guard: 4, Focus: 5 };

// Elements each element is strong against, indexed in contract order
// (Neutral, Fire, Water, Grass, Electric, Ground, Ice, Dragon, Dark).
const STRONG_AGAINST = [[], [3, 6], [1], [5], [2], [4], [7], [8], [0], []];

const beats = (attacker, defender) => STRONG_AGAINST[attacker].includes(defender);

export function elementMultiplier(attacker, defender) {
  if (attacker === NONE || defender === NONE) return 10000;
  if (beats(attacker, defender)) return 12500;
  if (beats(defender, attacker)) return 8000;
  return 10000;
}

export function attackMultiplier(attacker, defender) {
  let multiplier = elementMultiplier(attacker.element, defender.element);
  if (defender.secondElement !== NONE) {
    multiplier = Math.floor(multiplier * elementMultiplier(attacker.element, defender.secondElement) / 10000);
  }
  return Math.max(7000, Math.min(15000, multiplier));
}

/** Damage for one attack, including passives evaluated at the start of the round. */
export function battleBreakdown(card, enemy, { hp = card.maxHP, firstAttack = true, teammates = 0 } = {}) {
  const multiplier = attackMultiplier(card, enemy);
  return { multiplier, total: Number(relayDamage(card, enemy, BigInt(hp), firstAttack, teammates)) };
}

/** Mirrors Arena.simulateBattle; history uses the attributes snapshotted at reveal. */
export function simulateBattle(a, b) {
  let damageA = 0n;
  let damageB = 0n;
  let hpA = BigInt(a.maxHP);
  let hpB = BigInt(b.maxHP);
  const log = [];
  while (log.length < 20 && hpA > 0n && hpB > 0n) {
    damageA = relayDamage(a, b, hpA, log.length === 0, 0);
    damageB = relayDamage(b, a, hpB, log.length === 0, 0);
    hpA = damageB >= hpA ? 0n : hpA - damageB;
    hpB = damageA >= hpB ? 0n : hpB - damageA;
    log.push({ round: log.length + 1, hpA: Number(hpA), hpB: Number(hpB), damageA: Number(damageA), damageB: Number(damageB) });
  }
  let winner = 0;
  if (hpA === 0n && hpB === 0n) winner = 0;
  else if (hpA === 0n) winner = 2;
  else if (hpB === 0n) winner = 1;
  else if (hpA * BigInt(b.maxHP) > hpB * BigInt(a.maxHP)) winner = 1;
  else if (hpA * BigInt(b.maxHP) < hpB * BigInt(a.maxHP)) winner = 2;
  return { hpA: Number(hpA), hpB: Number(hpB), damageA: Number(damageA), damageB: Number(damageB), rounds: log.length, winner, log };
}

// Exact integer arithmetic for both battle helpers. Display metadata may stay Number.
function relayDamage(a, b, hp, firstAttack, teammates) {
  let multiplier = BigInt(elementMultiplier(a.element, b.element));
  if (b.secondElement !== NONE) multiplier = multiplier * BigInt(elementMultiplier(a.element, b.secondElement)) / 10000n;
  if (multiplier < 7000n) multiplier = 7000n;
  if (multiplier > 15000n) multiplier = 15000n;
  let defense = BigInt(b.def);
  if (a.passive === PASSIVE.Pierce) defense = defense * 80n / 100n;
  let amount = BigInt(a.atk) * multiplier * 100n / (10000n * (100n + defense));
  if (amount === 0n) amount = 1n;
  if (a.passive === PASSIVE.Underdog && hp * 2n <= BigInt(a.maxHP)) {
    amount = amount * 120n / 100n;
  } else if (a.passive === PASSIVE.Resonance) {
    amount = amount * (100n + BigInt(teammates) * 5n) / 100n;
  } else if (a.passive === PASSIVE.Focus && firstAttack) {
    amount = amount * 125n / 100n;
  }
  if (b.passive === PASSIVE.Guard) amount = amount * 90n / 100n;
  return amount > 0n ? amount : 1n;
}

export function teamHpFraction(team, hp) {
  const denominator = team.reduce((product, card) => product * BigInt(card.maxHP), 1n);
  const numerator = hp.reduce((sum, value, i) => sum + BigInt(value) * (denominator / BigInt(team[i].maxHP)), 0n);
  return { numerator, denominator };
}

/** Ordered 3v3 relay, one global 20-round limit, survivor HP carries over. */
export function simulateTeamBattle(a, b) {
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(card => BigInt(card.maxHP) <= 0n)) {
    throw new Error("Relay battles require three cards with positive MaxHP on each team.");
  }
  const hpA = a.map(card => BigInt(card.maxHP));
  const hpB = b.map(card => BigInt(card.maxHP));
  const attackedA = [false, false, false];
  const attackedB = [false, false, false];
  const matches = team => team.map((card, index) => team.filter((other, i) => i !== index && other.element === card.element).length);
  const teammatesA = matches(a);
  const teammatesB = matches(b);
  let activeA = 0;
  let activeB = 0;
  const log = [];
  while (log.length < 20 && activeA < 3 && activeB < 3) {
    const damageA = relayDamage(a[activeA], b[activeB], hpA[activeA], !attackedA[activeA], teammatesA[activeA]);
    const damageB = relayDamage(b[activeB], a[activeA], hpB[activeB], !attackedB[activeB], teammatesB[activeB]);
    attackedA[activeA] = true;
    attackedB[activeB] = true;
    hpA[activeA] = damageB >= hpA[activeA] ? 0n : hpA[activeA] - damageB;
    hpB[activeB] = damageA >= hpB[activeB] ? 0n : hpB[activeB] - damageA;
    log.push({ round: log.length + 1, activeA, activeB, damageA, damageB, hpA: [...hpA], hpB: [...hpB] });
    if (hpA[activeA] === 0n) activeA++;
    if (hpB[activeB] === 0n) activeB++;
  }
  let winner = 0;
  if (activeA === 3 && activeB === 3) winner = 0;
  else if (activeA === 3) winner = 2;
  else if (activeB === 3) winner = 1;
  else {
    const scoreA = teamHpFraction(a, hpA);
    const scoreB = teamHpFraction(b, hpB);
    const crossA = scoreA.numerator * scoreB.denominator;
    const crossB = scoreB.numerator * scoreA.denominator;
    if (crossA > crossB) winner = 1;
    else if (crossB > crossA) winner = 2;
  }
  return { hpA, hpB, rounds: log.length, winner, log };
}
