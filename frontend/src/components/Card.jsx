import { ELEMENTS, RARITIES } from "../config/contracts.js";

const ELEMENT_ICONS = { Fire: "🔥", Water: "💧", Wood: "🌿" };

/**
 * One card face. `element` and `rarity` are the contract's enum numbers.
 * Pass onClick to make the card selectable (Forge and Arena pages).
 */
export default function Card({ tokenId, element, rarity, power, selected = false, disabled = false, onClick }) {
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
    <button type="button" className={className} aria-pressed={selected} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** The back of a card, shown before a new card is revealed. */
export function CardBack() {
  return (
    <div className="game-card card-back" aria-label="Face-down card">
      <span className="card-back-mark" aria-hidden="true">⚔️</span>
    </div>
  );
}

/**
 * A card that starts face down and flips over once `card` is set.
 * `shaking` animates the face-down card while a transaction is pending.
 */
export function CardReveal({ card, shaking = false }) {
  const className = ["flip", card ? "flipped" : "", shaking && !card ? "shaking" : ""].join(" ");
  return (
    <div className={className}>
      <div className="flip-inner">
        <div className="flip-face">
          <CardBack />
        </div>
        <div className="flip-face flip-front" aria-hidden={!card}>
          {card && <Card {...card} />}
        </div>
      </div>
    </div>
  );
}
