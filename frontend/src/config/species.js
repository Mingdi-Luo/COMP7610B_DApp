// Names and settings of the 27 creatures, indexed by species ID. Edit these freely: they are
// only used for display. Stats (elements, rarity, power, breeding rank) live in the
// ElementCards constructor, in the same order, and changing them needs a redeployment.
export const SPECIES = [
  { name: "Puffkin", icon: "🐹", lore: "A round little fluffball that naps through most fights." },
  { name: "Driftmane", icon: "🦙", lore: "A wandering grazer whose mane floats as if underwater." },
  { name: "Halcyra", icon: "🕊️", lore: "A pale bird said to appear only when a quarrel has ended." },
  { name: "Emberkit", icon: "🐈", lore: "A kitten with warm paws that leaves scorched pawprints." },
  { name: "Cindrake", icon: "🦎", lore: "A lizard that sheds its skin as flakes of hot ash." },
  { name: "Pyrovane", icon: "🐦‍🔥", lore: "A winged wyrm whose wingbeats turn the wind to flame." },
  { name: "Ripplet", icon: "🐟", lore: "A tiny fish that skips across puddles for fun." },
  { name: "Tidewarden", icon: "🦀", lore: "A patient crab that guards tide pools from intruders." },
  { name: "Abyssara", icon: "🐙", lore: "A deep-sea giant that has never once seen the sun." },
  { name: "Sproutle", icon: "🌱", lore: "A seedling that walks toward whichever window is sunniest." },
  { name: "Thornback", icon: "🦔", lore: "A burrower with a hedge of living brambles on its back." },
  { name: "Verdantis", icon: "🌳", lore: "An ancient walking grove with moss older than any map." },
  { name: "Zapling", icon: "🐝", lore: "A buzzing insect that gives a tiny shock when startled." },
  { name: "Voltarch", icon: "🦅", lore: "A raptor that rides storm fronts and dives with the bolt." },
  { name: "Stormregent", icon: "🌩️", lore: "A serpent of cloud that commands every thunderhead." },
  { name: "Burrowpaw", icon: "🦡", lore: "A stubborn digger that tunnels straight through anything." },
  { name: "Cragmaw", icon: "🐊", lore: "A cave ambusher that looks exactly like a pile of rocks." },
  { name: "Terravault", icon: "🐘", lore: "A colossal beast whose steps are mistaken for earthquakes." },
  { name: "Frostlet", icon: "🐧", lore: "A waddling chick that leaves a trail of tiny frost." },
  { name: "Rimefang", icon: "🐺", lore: "A wolf whose breath freezes the shallows as it hunts." },
  { name: "Cryomere", icon: "🧊", lore: "A living lake of black ice, silent until it is too late." },
  { name: "Wyrmlet", icon: "🐛", lore: "A newly hatched wyrm, already convinced it rules the sky." },
  { name: "Drakeshade", icon: "🦇", lore: "A drake that hides in its own shadow until it strikes." },
  { name: "Aethwyrm", icon: "🐉", lore: "An elder dragon that sleeps above the clouds for centuries." },
  { name: "Gloomlet", icon: "🐀", lore: "A timid creature that only comes out when the lamps die." },
  { name: "Umbralynx", icon: "🐆", lore: "A silent cat that is seen only after it has already left." },
  { name: "Nocthrone", icon: "🦉", lore: "The owl-monarch of moonless nights, watching from its perch." },
];

// Special breeding recipes, as species IDs. Mirrors the ElementCards constructor.
export const RECIPES = [
  { parents: [4, 7], child: 5 },
  { parents: [13, 16], child: 14 },
  { parents: [19, 22], child: 20 },
];

export const ELEMENT_ICONS = {
  Neutral: "⚪",
  Fire: "🔥",
  Water: "💧",
  Grass: "🌿",
  Electric: "⚡",
  Ground: "⛰️",
  Ice: "❄️",
  Dragon: "🐲",
  Dark: "🌑",
};
