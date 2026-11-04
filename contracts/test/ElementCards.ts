import { expect } from "chai";
import { network } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

const { ethers, networkHelpers } = await network.create();

const Rarity = { Common: 0, Rare: 1, Legendary: 2 };
const Passive = { None: 0 };
const Gender = { Male: 0, Female: 1 };
// Species IDs, in the order of the ElementCards constructor.
const Species = {
  Puffkin: 0,
  Driftmane: 1,
  Halcyra: 2,
  Emberkit: 3,
  Cindrake: 4,
  Pyrovane: 5,
  Ripplet: 6,
  Tidewarden: 7,
  Voltarch: 13,
  Stormregent: 14,
  Cragmaw: 16,
  Rimefang: 19,
  Cryomere: 20,
  Drakeshade: 22,
  Gloomlet: 24,
};
const PACK_PRICE = 1_000n;
const BREED_COOLDOWN = 60;

// ethers.parseEther("1") buys 1,000,000 coins, plenty for any test.
async function deployWith(contractName: string) {
  const [owner, alice, bob] = await ethers.getSigners();
  const coin = await ethers.deployContract("GameCoin");
  const cards = await ethers.deployContract(contractName, [await coin.getAddress()]);
  await coin.setGameContract(await cards.getAddress(), true);
  await coin.connect(alice).topUp({ value: ethers.parseEther("1") });
  await coin.connect(bob).topUp({ value: ethers.parseEther("1") });
  return { coin, cards, owner, alice, bob };
}

const deployCards = () => deployWith("ElementCards");

// MockElementCards can mint cards with chosen attributes, for exact setups.
async function deployMockCards() {
  const deployed = await deployWith("MockElementCards");
  const { cards } = deployed;

  async function mint(to: { address: string }, speciesId: number, power = 20, gender = Gender.Male) {
    const tokenId = await cards.mintCard.staticCall(to.address, speciesId, power, Passive.None, gender);
    await cards.mintCard(to.address, speciesId, power, Passive.None, gender);
    return tokenId;
  }

  return { ...deployed, mint };
}

describe("ElementCards", function () {
  describe("configuration", function () {
    it("has the expected name, symbol and pack price", async function () {
      const { coin, cards } = await deployCards();
      expect(await cards.name()).to.equal("Elemental Duel Card");
      expect(await cards.symbol()).to.equal("EDC");
      expect(await cards.PACK_PRICE()).to.equal(PACK_PRICE);
      expect(await cards.coin()).to.equal(await coin.getAddress());
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

    it("has nine species of each rarity, all with powers inside their rarity's range", async function () {
      const { cards } = await deployCards();
      expect(await cards.speciesCount()).to.equal(27n);
      const spread = await cards.POWER_SPREAD();
      const perRarity = [0, 0, 0];

      for (let id = 0; id < 27; id++) {
        const species = await cards.getSpecies(id);
        perRarity[Number(species.rarity)]++;
        const [min, max] = await cards.powerRange(species.rarity);
        expect(species.basePower).to.be.at.least(min);
        expect(species.basePower + spread - 1n).to.be.at.most(max);
      }
      expect(perRarity).to.deep.equal([9, 9, 9]);
      await expect(cards.getSpecies(27)).to.be.revertedWithCustomError(cards, "UnknownSpecies").withArgs(27n);
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
    it("reverts when the player does not have enough coins", async function () {
      const { coin, cards, owner } = await deployCards();
      await expect(cards.connect(owner).openPack()).to.be.revertedWithCustomError(coin, "ERC20InsufficientBalance");
    });

    it("spends the pack price, mints one card to the caller and emits PackOpened", async function () {
      const { coin, cards, alice } = await deployCards();
      const before = await coin.balanceOf(alice.address);

      await expect(cards.connect(alice).openPack())
        .to.emit(cards, "PackOpened")
        .withArgs(alice.address, 1n, anyValue, anyValue, anyValue);

      expect(await coin.balanceOf(alice.address)).to.equal(before - PACK_PRICE);
      expect(await cards.ownerOf(1)).to.equal(alice.address);
      expect(await cards.cardsOf(alice.address)).to.deep.equal([1n]);
    });

    it("mints cards that match their species, with no passive and either gender", async function () {
      const { cards, alice } = await deployCards();
      for (let i = 0; i < 30; i++) {
        await cards.connect(alice).openPack();
      }

      const genders = new Set<bigint>();
      for (const tokenId of await cards.cardsOf(alice.address)) {
        const card = await cards.getCard(tokenId);
        const species = await cards.getSpecies(card.speciesId);
        expect(card.element).to.equal(species.element);
        expect(card.secondElement).to.equal(species.secondElement);
        expect(card.rarity).to.equal(species.rarity);
        expect(card.power).to.be.within(species.basePower, species.basePower + 11n);
        expect(card.passive).to.equal(BigInt(Passive.None));
        expect(card.generation).to.equal(0n);
        genders.add(card.gender);
      }
      // All 30 sharing one gender has a chance of about 1 in 500,000,000.
      expect([...genders].sort()).to.deep.equal([0n, 1n]);
    });

    it("roughly matches the drop rates over 1,000 packs", async function () {
      this.timeout(120_000);
      const { cards, alice } = await deployCards();
      const counts = [0, 0, 0];
      const cardsAddress = await cards.getAddress();

      for (let i = 0; i < 1_000; i++) {
        const receipt = await (await cards.connect(alice).openPack()).wait();
        // GameCoin logs are skipped: its Transfer event has the same topic as the card's.
        const opened = receipt!.logs
          .filter((log) => log.address === cardsAddress)
          .map((log) => cards.interface.parseLog(log))
          .find((event) => event?.name === "PackOpened");
        counts[Number(opened!.args.rarity)]++;
      }

      // Each bound is more than three standard deviations from the expected count.
      expect(counts[Rarity.Common]).to.be.within(650, 750);
      expect(counts[Rarity.Rare]).to.be.within(200, 300);
      expect(counts[Rarity.Legendary]).to.be.within(20, 80);
    });
  });

  describe("merge", function () {
    it("burns three same-rarity cards and mints one card of the next rarity", async function () {
      const { cards, alice, mint } = await deployMockCards();
      const ids = [
        await mint(alice, Species.Puffkin),
        await mint(alice, Species.Emberkit),
        await mint(alice, Species.Ripplet),
      ];

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
      for (let i = 0; i < 3; i++) await mint(alice, Species.Driftmane, 50);

      await cards.connect(alice).merge([1, 2, 3]);

      const upgraded = await cards.getCard(4);
      expect(upgraded.rarity).to.equal(BigInt(Rarity.Legendary));
      expect(upgraded.power).to.be.within(70n, 100n);
    });

    it("emits CardsMerged with the burned and new token IDs", async function () {
      const { cards, alice, mint } = await deployMockCards();
      for (let i = 0; i < 3; i++) await mint(alice, Species.Puffkin);

      await expect(cards.connect(alice).merge([1, 2, 3]))
        .to.emit(cards, "CardsMerged")
        .withArgs(alice.address, [1n, 2n, 3n], 4n);
    });

    it("reverts with NotCardOwner when a card belongs to someone else", async function () {
      const { cards, alice, bob, mint } = await deployMockCards();
      await mint(alice, Species.Puffkin);
      await mint(alice, Species.Puffkin);
      const bobs = await mint(bob, Species.Puffkin);

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
      for (let i = 0; i < 3; i++) await mint(alice, Species.Puffkin);

      await expect(cards.connect(alice).merge([1, 2, 1]))
        .to.be.revertedWithCustomError(cards, "DuplicateCard")
        .withArgs(1n);
    });

    it("reverts with RarityMismatch when rarities differ", async function () {
      const { cards, alice, mint } = await deployMockCards();
      await mint(alice, Species.Puffkin);
      await mint(alice, Species.Puffkin);
      await mint(alice, Species.Driftmane, 50);

      await expect(cards.connect(alice).merge([1, 2, 3])).to.be.revertedWithCustomError(cards, "RarityMismatch");
    });

    it("reverts with CannotMergeLegendary for Legendary cards", async function () {
      const { cards, alice, mint } = await deployMockCards();
      for (let i = 0; i < 3; i++) await mint(alice, Species.Halcyra, 90);

      await expect(cards.connect(alice).merge([1, 2, 3])).to.be.revertedWithCustomError(
        cards,
        "CannotMergeLegendary",
      );
    });
  });

  describe("decompose", function () {
    it("burns the card and pays the value of its rarity", async function () {
      const { coin, cards, alice, mint } = await deployMockCards();
      const cases = [
        { species: Species.Puffkin, power: 20, value: 300n },
        { species: Species.Driftmane, power: 50, value: 900n },
        { species: Species.Halcyra, power: 80, value: 2_700n },
      ];

      for (const { species, power, value } of cases) {
        const id = await mint(alice, species, power);
        const before = await coin.balanceOf(alice.address);

        await expect(cards.connect(alice).decompose(id))
          .to.emit(cards, "CardDecomposed")
          .withArgs(alice.address, id, value);

        expect(await coin.balanceOf(alice.address)).to.equal(before + value);
        await expect(cards.getCard(id)).to.be.revertedWithCustomError(cards, "ERC721NonexistentToken");
      }
    });

    it("reverts with NotCardOwner for someone else's card", async function () {
      const { cards, alice, bob, mint } = await deployMockCards();
      const id = await mint(alice, Species.Puffkin);
      await expect(cards.connect(bob).decompose(id))
        .to.be.revertedWithCustomError(cards, "NotCardOwner")
        .withArgs(id);
    });

    it("never pays more than the coins it takes to get the card", async function () {
      const { cards } = await deployCards();
      const [common, rare, legendary] = await Promise.all(
        Object.values(Rarity).map((rarity) => cards.decomposeValue(rarity)),
      );

      // A pack, and the merges made from packs, always lose coins when decomposed.
      expect(common).to.be.lessThan(PACK_PRICE);
      expect(rare).to.equal(common * 3n);
      expect(legendary).to.equal(rare * 3n);

      // Breeding keeps both parents, so a child must always cost more than it returns.
      for (const rarity of Object.values(Rarity)) {
        expect(await cards.decomposeValue(rarity)).to.be.lessThan(await cards.breedFee(rarity));
      }
    });
  });

  describe("enchant", function () {
    it("charges by rarity, gives a passive and emits CardEnchanted", async function () {
      const { coin, cards, alice, mint } = await deployMockCards();
      const cases = [
        { species: Species.Puffkin, power: 20, cost: 200n },
        { species: Species.Driftmane, power: 50, cost: 500n },
        { species: Species.Halcyra, power: 80, cost: 1_000n },
      ];

      for (const { species, power, cost } of cases) {
        const id = await mint(alice, species, power);
        const before = await coin.balanceOf(alice.address);

        await expect(cards.connect(alice).enchant(id))
          .to.emit(cards, "CardEnchanted")
          .withArgs(alice.address, id, anyValue);

        expect(await coin.balanceOf(alice.address)).to.equal(before - cost);
        expect((await cards.getCard(id)).passive).to.not.equal(BigInt(Passive.None));
      }
    });

    it("rolls every passive and replaces the old one each time", async function () {
      const { cards, alice, mint } = await deployMockCards();
      const id = await mint(alice, Species.Puffkin);
      const seen = new Set<bigint>();

      for (let i = 0; i < 80; i++) {
        await cards.connect(alice).enchant(id);
        seen.add((await cards.getCard(id)).passive);
      }

      // Missing any of the five in 80 rolls has a chance of about 1 in 1,000,000.
      expect([...seen].sort()).to.deep.equal([1n, 2n, 3n, 4n, 5n]);
    });

    it("reverts for someone else's card or without enough coins", async function () {
      const { coin, cards, owner, alice, bob, mint } = await deployMockCards();
      const id = await mint(alice, Species.Puffkin);
      await expect(cards.connect(bob).enchant(id))
        .to.be.revertedWithCustomError(cards, "NotCardOwner")
        .withArgs(id);

      const ownerCard = await mint(owner, Species.Puffkin);
      await expect(cards.connect(owner).enchant(ownerCard)).to.be.revertedWithCustomError(
        coin,
        "ERC20InsufficientBalance",
      );
    });
  });

  describe("breed", function () {
    it("follows the rank formula, with ties going to the lower species ID", async function () {
      const { cards } = await deployCards();
      // Ranks 100 and 120 average to 110, which is Emberkit.
      expect(await cards.breedResult(Species.Puffkin, Species.Ripplet)).to.equal(BigInt(Species.Emberkit));
      // Ranks 100 and 110 average to 105, equally close to both, so the lower ID wins.
      expect(await cards.breedResult(Species.Puffkin, Species.Emberkit)).to.equal(BigInt(Species.Puffkin));
      // A species bred with itself stays the same.
      expect(await cards.breedResult(Species.Cindrake, Species.Cindrake)).to.equal(BigInt(Species.Cindrake));
      // Common (100) and Legendary (500) average to a Rare (300).
      expect(await cards.breedResult(Species.Puffkin, Species.Halcyra)).to.equal(BigInt(Species.Driftmane));
      // Common (100) and Rare (300) average to 200, closest to rank 180.
      expect(await cards.breedResult(Species.Puffkin, Species.Driftmane)).to.equal(BigInt(Species.Gloomlet));
    });

    it("uses special recipes in either parent order", async function () {
      const { cards } = await deployCards();
      const recipes = [
        [Species.Cindrake, Species.Tidewarden, Species.Pyrovane],
        [Species.Voltarch, Species.Cragmaw, Species.Stormregent],
        [Species.Rimefang, Species.Drakeshade, Species.Cryomere],
      ];
      for (const [a, b, child] of recipes) {
        expect(await cards.breedResult(a, b)).to.equal(BigInt(child));
        expect(await cards.breedResult(b, a)).to.equal(BigInt(child));
      }
    });

    it("reverts breedResult for an unknown species", async function () {
      const { cards } = await deployCards();
      await expect(cards.breedResult(0, 27)).to.be.revertedWithCustomError(cards, "UnknownSpecies").withArgs(27n);
    });

    it("charges by the child's rarity, keeps the parents and emits CardBred", async function () {
      const { coin, cards, alice, mint } = await deployMockCards();
      const a = await mint(alice, Species.Puffkin, 20, Gender.Male);
      const b = await mint(alice, Species.Ripplet, 20, Gender.Female);
      const before = await coin.balanceOf(alice.address);

      await expect(cards.connect(alice).breed(a, b))
        .to.emit(cards, "CardBred")
        .withArgs(alice.address, a, b, 3n, Species.Emberkit);

      expect(await coin.balanceOf(alice.address)).to.equal(before - 500n);
      expect(await cards.cardsOf(alice.address)).to.deep.equal([1n, 2n, 3n]);
      const child = await cards.getCard(3);
      expect(child.speciesId).to.equal(BigInt(Species.Emberkit));
      expect(child.generation).to.equal(1n);
      expect(child.passive).to.equal(BigInt(Passive.None));
      expect(child.gender).to.be.within(0n, 1n);
    });

    it("needs one male and one female, in either order", async function () {
      const { cards, alice, mint } = await deployMockCards();
      const male = await mint(alice, Species.Puffkin, 20, Gender.Male);
      const otherMale = await mint(alice, Species.Puffkin, 20, Gender.Male);
      const female = await mint(alice, Species.Ripplet, 20, Gender.Female);
      const otherFemale = await mint(alice, Species.Ripplet, 20, Gender.Female);

      await expect(cards.connect(alice).breed(male, otherMale)).to.be.revertedWithCustomError(cards, "SameGender");
      await expect(cards.connect(alice).breed(female, otherFemale)).to.be.revertedWithCustomError(cards, "SameGender");

      await expect(cards.connect(alice).breed(female, male)).to.emit(cards, "CardBred");
    });

    it("charges the Legendary fee for a special recipe", async function () {
      const { coin, cards, alice, mint } = await deployMockCards();
      const a = await mint(alice, Species.Cindrake, 50, Gender.Male);
      const b = await mint(alice, Species.Tidewarden, 50, Gender.Female);
      const before = await coin.balanceOf(alice.address);

      await cards.connect(alice).breed(a, b);

      expect(await coin.balanceOf(alice.address)).to.equal(before - 4_500n);
      const child = await cards.getCard(3);
      expect(child.speciesId).to.equal(BigInt(Species.Pyrovane));
      expect(child.rarity).to.equal(BigInt(Rarity.Legendary));
    });

    it("makes parents wait longer each generation", async function () {
      const { cards, alice, mint } = await deployMockCards();
      const a = await mint(alice, Species.Puffkin, 20, Gender.Male);
      const b = await mint(alice, Species.Ripplet, 20, Gender.Female);
      await cards.connect(alice).breed(a, b);

      const readyAt = (await cards.getCard(a)).breedReadyAt;
      expect(readyAt).to.equal(BigInt((await networkHelpers.time.latest()) + BREED_COOLDOWN));
      const mate = await mint(alice, Species.Puffkin, 20, Gender.Female);
      await expect(cards.connect(alice).breed(a, mate))
        .to.be.revertedWithCustomError(cards, "BreedOnCooldown")
        .withArgs(a, readyAt);

      await networkHelpers.time.increase(BREED_COOLDOWN + 1);
      await cards.connect(alice).breed(a, mate);

      // The first child is generation 1, so as a parent it rests for two cooldowns.
      const child = 3n;
      const childGender = (await cards.getCard(child)).gender;
      const childMate = await mint(
        alice,
        Species.Puffkin,
        20,
        childGender === BigInt(Gender.Male) ? Gender.Female : Gender.Male,
      );
      await cards.connect(alice).breed(child, childMate);
      expect((await cards.getCard(child)).breedReadyAt).to.equal(
        BigInt((await networkHelpers.time.latest()) + 2 * BREED_COOLDOWN),
      );
      expect((await cards.getCard(7)).generation).to.equal(2n);
    });

    it("reverts for one card used twice, someone else's card, or too few coins", async function () {
      const { coin, cards, owner, alice, bob, mint } = await deployMockCards();
      const a = await mint(alice, Species.Puffkin, 20, Gender.Male);
      const b = await mint(bob, Species.Puffkin, 20, Gender.Female);

      await expect(cards.connect(alice).breed(a, a))
        .to.be.revertedWithCustomError(cards, "DuplicateCard")
        .withArgs(a);
      await expect(cards.connect(alice).breed(a, b))
        .to.be.revertedWithCustomError(cards, "NotCardOwner")
        .withArgs(b);

      const c = await mint(owner, Species.Puffkin, 20, Gender.Male);
      const d = await mint(owner, Species.Puffkin, 20, Gender.Female);
      await expect(cards.connect(owner).breed(c, d)).to.be.revertedWithCustomError(coin, "ERC20InsufficientBalance");
    });
  });
});
