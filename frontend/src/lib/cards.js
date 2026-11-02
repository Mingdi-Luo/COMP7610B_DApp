/** Plain { tokenId, element, rarity, power } numbers from a contract Card (bigints). */
export function toCard(tokenId, card) {
  return {
    tokenId: Number(tokenId),
    element: Number(card.element),
    rarity: Number(card.rarity),
    power: Number(card.power),
  };
}

/** The first `name` event that `contract` emitted in a transaction receipt, or undefined. */
export function findEvent(receipt, contract, name) {
  for (const log of receipt.logs) {
    const parsed = contract.interface.parseLog(log);
    if (parsed?.name === name) return parsed;
  }
  return undefined;
}

// Element each element beats, indexed in contract order (Fire, Water, Wood):
// Fire beats Wood, Water beats Fire, Wood beats Water. Mirrors Arena.beats.
const BEATS = [2, 0, 1];

export function beats(attacker, defender) {
  return BEATS[attacker] === defender;
}

/** Power of `card` against `enemy`, including the 1.5x element advantage. Mirrors Arena. */
export function battlePower(card, enemy) {
  return beats(card.element, enemy.element) ? Math.floor((card.power * 3) / 2) : card.power;
}
