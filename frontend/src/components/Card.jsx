import { ELEMENTS, RARITIES } from "../config/contracts.js";

const ELEMENT_ICONS = { Fire: "🔥", Water: "💧", Wood: "🌿" };

/**
 * One card face. `element` and `rarity` are the contract's enum numbers.
 * Pass onClick to make the card selectable (Forge and Arena pages).
 */
export default function Card({ tokenId, element, rarity, power, selected = false, onClick }) {
  const elementName = ELEMENTS[element];
  const rarityName = RARITIES[rarity];
  const className = [
    "game-card",
    `element-${elementName.toLowerCase()}`,
    `rarity-${rarityName.toLowerCase()}`,
    selected ? "selected" : "",
  ].join(" ");

  const content = (
    <>
      <span className="game-card-rarity">{rarityName}</span>
      <span className="game-card-icon" aria-hidden="true">{ELEMENT_ICONS[elementName]}</span>
      <span className="game-card-element">{elementName}</span>
      <strong className="game-card-power">{power}</strong>
      <span className="game-card-id">#{tokenId}</span>
    </>
  );

  return onClick ? (
    <button type="button" className={className} aria-pressed={selected} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
