import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const Rarity = { Common: 0, Rare: 1, Legendary: 2 };

async function deployCards() {
  const [owner, alice, bob] = await ethers.getSigners();
  const cards = await ethers.deployContract("ElementCards");
  return { cards, owner, alice, bob };
}

describe("ElementCards", function () {
  describe("configuration", function () {
    it("has the expected name, symbol and pack price", async function () {
      const { cards } = await deployCards();
      expect(await cards.name()).to.equal("Elemental Duel Card");
      expect(await cards.symbol()).to.equal("EDC");
      expect(await cards.PACK_PRICE()).to.equal(ethers.parseEther("0.001"));
    });

    it("publishes drop rates that add up to 100%", async function () {
      const { cards } = await deployCards();
      let total = 0n;
      for (const rarity of Object.values(Rarity)) {
        total += await cards.dropRate(rarity);
      }
      expect(total).to.equal(10_000n);
    });

    it("publishes non-overlapping power ranges in rarity order", async function () {
      const { cards } = await deployCards();
      const [commonMin, commonMax] = await cards.powerRange(Rarity.Common);
      const [rareMin, rareMax] = await cards.powerRange(Rarity.Rare);
      const [legendaryMin, legendaryMax] = await cards.powerRange(Rarity.Legendary);
      expect([commonMin, commonMax, rareMin, rareMax, legendaryMin, legendaryMax]).to.deep.equal([
        10n, 39n, 40n, 69n, 70n, 100n,
      ]);
    });

    it("reverts getCard for a card that does not exist", async function () {
      const { cards } = await deployCards();
      await expect(cards.getCard(1)).to.be.revertedWithCustomError(cards, "ERC721NonexistentToken");
    });

    it("returns an empty list from cardsOf for a new player", async function () {
      const { cards, alice } = await deployCards();
      expect(await cards.cardsOf(alice.address)).to.deep.equal([]);
    });
  });

  // Specs for the TODO functions. Turn each into a real test while implementing.
  describe("openPack (TODO)", function () {
    it("reverts with WrongPayment unless exactly PACK_PRICE is sent");
    it("mints one card to the caller and emits PackOpened");
    it("gives each card a power inside its rarity's powerRange");
    it("roughly matches the drop rates over 1,000 packs");
    it("keeps the pack price in the contract until the owner withdraws");
  });

  describe("merge (TODO)", function () {
    it("burns three same-rarity cards and mints one card of the next rarity");
    it("emits CardsMerged with the burned and new token IDs");
    it("reverts with NotCardOwner when a card belongs to someone else");
    it("reverts with DuplicateCard when the same ID is passed twice");
    it("reverts with RarityMismatch when rarities differ");
    it("reverts with CannotMergeLegendary for Legendary cards");
  });

  describe("withdraw", function () {
    it("can only be called by the owner", async function () {
      const { cards, alice } = await deployCards();
      await expect(cards.connect(alice).withdraw()).to.be.revertedWithCustomError(
        cards,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
