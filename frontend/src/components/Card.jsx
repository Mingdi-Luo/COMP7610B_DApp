import { ELEMENTS, GENDERS, GENDER_SYMBOLS, PASSIVES, PASSIVE_EFFECTS, RARITIES } from "../config/contracts.js";
import { ELEMENT_ICONS, SPECIES } from "../config/species.js";

/**
 * One card face. `element`, `rarity`, `passive` and `gender` are the contract's enum numbers.
 * Pass onClick to make the card selectable, and `tag` for a short status such as "In battle".
 */
export default function Card({
  tokenId,
  speciesId,
  element,
  secondElement,
  rarity,
  power,
  passive = 0,
  gender = 0,
  generation = 0,
  selected = false,
  disabled = false,
  tag,
  onClick,
}) {
  const species = SPECIES[speciesId];
  const elementName = ELEMENTS[element];
  const rarityName = RARITIES[rarity];
  const passiveName = PASSIVES[passive];
  const genderName = GENDERS[gender];
  const elementNames = secondElement === element ? [elementName] : [elementName, ELEMENTS[secondElement]];
  const className = [
    "game-card",
    `element-${elementName.toLowerCase()}`,
    `rarity-${rarityName.toLowerCase()}`,
    selected ? "selected" : "",
  ].join(" ");

  const content = (
    <>
      <span className="game-card-rarity">{rarityName}</span>
      <span className="game-card-icon" aria-hidden="true">{species.icon}</span>
      <span className="game-card-name">
        {species.name}{" "}
        <span className={`gender-${genderName.toLowerCase()}`} role="img" aria-label={genderName} title={genderName}>
          {GENDER_SYMBOLS[gender]}
        </span>
      </span>
      <span className="game-card-element" title={elementNames.join(" / ")}>
        {elementNames.map((name) => (
          <span key={name}>
            <span aria-hidden="true">{ELEMENT_ICONS[name]}</span>
            <span className="element-name"> {name}</span>
          </span>
        ))}
      </span>
      <strong className="game-card-power">{power}</strong>
      {passive > 0 && (
        <span className="game-card-passive" title={PASSIVE_EFFECTS[passiveName]}>✨ {passiveName}</span>
      )}
      <span className="game-card-id">#{tokenId}{generation > 0 && ` · Gen ${generation}`}</span>
      {tag && <span className="game-card-tag">{tag}</span>}
    </>
  );

  return onClick ? (
    <button type="button" className={className} title={species.lore} aria-pressed={selected} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className} title={species.lore}>{content}</div>
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
