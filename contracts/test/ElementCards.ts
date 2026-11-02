import { expect } from "chai";
import { network } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

const { ethers } = await network.create();

const Element = { Fire: 0, Water: 1, Wood: 2 };
const Rarity = { Common: 0, Rare: 1, Legendary: 2 };
const PACK_PRICE = ethers.parseEther("0.001");

async function deployCards() {
  const [owner, alice, bob] = await ethers.getSigners();
  const cards = await ethers.deployContract("ElementCards");
  return { cards, owner, alice, bob };
}

// MockElementCards can mint cards with chosen attributes, for exact merge setups.
async function deployMockCards() {
  const [owner, alice, bob] = await ethers.getSigners();
  const cards = await ethers.deployContract("MockElementCards");

  async function mint(to: { address: string }, rarity: number, element = Element.Fire, power = 20) {
    const tokenId = await cards.mintCard.staticCall(to.address, element, rarity, power);
    await cards.mintCard(to.address, element, rarity, power);
    return tokenId;
  }

  return { cards, owner, alice, bob, mint };
}

describe("ElementCards", function () {
  describe("configuration", function () {
    it("has the expected name, symbol and pack price", async function () {
      const { cards } = await deployCards();
      expect(await cards.name()).to.equal("Elemental Duel Card");
      expect(await cards.symbol()).to.equal("EDC");
      expect(await cards.PACK_PRICE()).to.equal(PACK_PRICE);
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

  describe("openPack", function () {
    it("reverts with WrongPayment unless exactly PACK_PRICE is sent", async function () {
      const { cards, alice } = await deployCards();
      await expect(cards.connect(alice).openPack())
        .to.be.revertedWithCustomError(cards, "WrongPayment")
        .withArgs(0n, PACK_PRICE);
      await expect(cards.connect(alice).openPack({ value: PACK_PRICE * 2n }))
        .to.be.revertedWithCustomError(cards, "WrongPayment")
        .withArgs(PACK_PRICE * 2n, PACK_PRICE);
    });

    it("mints one card to the caller and emits PackOpened", async function () {
      const { cards, alice } = await deployCards();
      await expect(cards.connect(alice).openPack({ value: PACK_PRICE }))
        .to.emit(cards, "PackOpened")
        .withArgs(alice.address, 1n, anyValue, anyValue, anyValue);

      expect(await cards.ownerOf(1)).to.equal(alice.address);
      expect(await cards.cardsOf(alice.address)).to.deep.equal([1n]);
    });

    it("gives each card a power inside its rarity's powerRange", async function () {
      const { cards, alice } = await deployCards();
      for (let i = 0; i < 30; i++) {
        await cards.connect(alice).openPack({ value: PACK_PRICE });
      }

      for (const tokenId of await cards.cardsOf(alice.address)) {
        const card = await cards.getCard(tokenId);
        const [min, max] = await cards.powerRange(card.rarity);
        expect(card.power).to.be.within(min, max);
        expect(card.element).to.be.within(0n, 2n);
      }
    });

    it("roughly matches the drop rates over 1,000 packs", async function () {
      this.timeout(120_000);
      const { cards, alice } = await deployCards();
      const counts = [0, 0, 0];

      for (let i = 0; i < 1_000; i++) {
        const receipt = await (await cards.connect(alice).openPack({ value: PACK_PRICE })).wait();
        const opened = receipt!.logs
          .map((log) => cards.interface.parseLog(log))
          .find((event) => event?.name === "PackOpened");
        counts[Number(opened!.args.rarity)]++;
      }

      // Each bound is more than three standard deviations from the expected count.
      expect(counts[Rarity.Common]).to.be.within(650, 750);
      expect(counts[Rarity.Rare]).to.be.within(200, 300);
      expect(counts[Rarity.Legendary]).to.be.within(20, 80);
    });

    it("keeps the pack price in the contract until the owner withdraws", async function () {
      const { cards, owner, alice, bob } = await deployCards();
      await cards.connect(alice).openPack({ value: PACK_PRICE });
      await cards.connect(bob).openPack({ value: PACK_PRICE });
      expect(await ethers.provider.getBalance(cards)).to.equal(PACK_PRICE * 2n);

      await expect(cards.withdraw()).to.changeEtherBalances(
        ethers,
        [cards, owner],
        [-PACK_PRICE * 2n, PACK_PRICE * 2n],
      );
    });
  });

  describe("merge", function () {
    it("burns three same-rarity cards and mints one card of the next rarity", async function () {
      const { cards, alice, mint } = await deployMockCards();
      const ids = [await mint(alice, Rarity.Common), await mint(alice, Rarity.Common), await mint(alice, Rarity.Common)];

      await cards.connect(alice).merge([ids[0], ids[1], ids[2]]);

      for (const id of ids) {
        await expect(cards.getCard(id)).to.be.revertedWithCustomError(cards, "ERC721NonexistentToken");
      }
      expect(await cards.cardsOf(alice.address)).to.deep.equal([4n]);
      const upgraded = await cards.getCard(4);
      expect(upgraded.rarity).to.equal(BigInt(Rarity.Rare));
      expect(upgraded.power).to.be.within(40n, 69n);
    });

    it("turns three Rare cards into a Legendary card", async function () {
      const { cards, alice, mint } = await deployMockCards();
      const ids = [await mint(alice, Rarity.Rare), await mint(alice, Rarity.Rare), await mint(alice, Rarity.Rare)];

      await cards.connect(alice).merge([ids[0], ids[1], ids[2]]);

      const upgraded = await cards.getCard(4);
      expect(upgraded.rarity).to.equal(BigInt(Rarity.Legendary));
      expect(upgraded.power).to.be.within(70n, 100n);
    });

    it("emits CardsMerged with the burned and new token IDs", async function () {
      const { cards, alice, mint } = await deployMockCards();
      for (let i = 0; i < 3; i++) await mint(alice, Rarity.Common);

      await expect(cards.connect(alice).merge([1, 2, 3]))
        .to.emit(cards, "CardsMerged")
        .withArgs(alice.address, [1n, 2n, 3n], 4n);
    });

    it("reverts with NotCardOwner when a card belongs to someone else", async function () {
      const { cards, alice, bob, mint } = await deployMockCards();
      await mint(alice, Rarity.Common);
      await mint(alice, Rarity.Common);
      const bobs = await mint(bob, Rarity.Common);

      await expect(cards.connect(alice).merge([1, 2, bobs]))
        .to.be.revertedWithCustomError(cards, "NotCardOwner")
        .withArgs(bobs);
      // A card that was never minted is not owned either.
      await expect(cards.connect(alice).merge([1, 2, 99]))
        .to.be.revertedWithCustomError(cards, "NotCardOwner")
        .withArgs(99n);
    });

    it("reverts with DuplicateCard when the same ID is passed twice", async function () {
      const { cards, alice, mint } = await deployMockCards();
      for (let i = 0; i < 3; i++) await mint(alice, Rarity.Common);

      await expect(cards.connect(alice).merge([1, 2, 1]))
        .to.be.revertedWithCustomError(cards, "DuplicateCard")
        .withArgs(1n);
    });

    it("reverts with RarityMismatch when rarities differ", async function () {
      const { cards, alice, mint } = await deployMockCards();
      await mint(alice, Rarity.Common);
      await mint(alice, Rarity.Common);
      await mint(alice, Rarity.Rare);

      await expect(cards.connect(alice).merge([1, 2, 3])).to.be.revertedWithCustomError(cards, "RarityMismatch");
    });

    it("reverts with CannotMergeLegendary for Legendary cards", async function () {
      const { cards, alice, mint } = await deployMockCards();
      for (let i = 0; i < 3; i++) await mint(alice, Rarity.Legendary, Element.Water, 90);

      await expect(cards.connect(alice).merge([1, 2, 3])).to.be.revertedWithCustomError(
        cards,
        "CannotMergeLegendary",
      );
    });
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
