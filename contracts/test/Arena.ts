import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const Element = { Neutral: 0, Fire: 1, Water: 2, Grass: 3, Electric: 4, Ground: 5, Ice: 6, Dragon: 7, Dark: 8 };
const Passive = { None: 0, Pierce: 1, Underdog: 2, Resonance: 3, Guard: 4, Focus: 5 };
const MALE = 0;
const Status = { None: 0n, Open: 1n, Joined: 2n, Resolved: 3n, Cancelled: 4n };
// Single-element Common species IDs, in the order of the ElementCards constructor.
const Species = { Puffkin: 0, Emberkit: 3, Ripplet: 6, Sproutle: 9, Zapling: 12, Gloomlet: 24 };
const STAKE = 1_000n;
const REVEAL_WINDOW = 600;

type Player = { address: string };
type CardSpec = [speciesId: number, power: number, passive?: number];

async function deployArena() {
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const coin = await ethers.deployContract("GameCoin");
  // The mock mints cards with chosen attributes, so each matchup is exact.
  const cards = await ethers.deployContract("MockElementCards", [await coin.getAddress()]);
  const arena = await ethers.deployContract("Arena", [await cards.getAddress()]);
  await coin.setGameContract(await cards.getAddress(), true);
  await coin.setGameContract(await arena.getAddress(), true);
  for (const player of [alice, bob]) {
    await coin.connect(player).topUp({ value: ethers.parseEther("1") });
  }

  async function mint(to: Player, [speciesId, power, passive = Passive.None]: CardSpec) {
    const tokenId = await cards.mintCard.staticCall(to.address, speciesId, power, passive, MALE);
    await cards.mintCard(to.address, speciesId, power, passive, MALE);
    return tokenId;
  }

  // Same hash as frontend/src/lib/commitment.js.
  function commit(player: Player, tokenId: bigint) {
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const commitment = ethers.solidityPackedKeccak256(
      ["uint256", "bytes32", "address"],
      [tokenId, salt, player.address],
    );
    return { tokenId, salt, commitment };
  }

  // Alice creates battle 1 with `aliceCard`, Bob joins it with `bobCard`.
  async function startBattle(aliceCard: CardSpec, bobCard: CardSpec, stake = STAKE) {
    const aliceSecret = commit(alice, await mint(alice, aliceCard));
    const bobSecret = commit(bob, await mint(bob, bobCard));
    await arena.connect(alice).createBattle(aliceSecret.commitment, stake);
    await arena.connect(bob).joinBattle(1, bobSecret.commitment);
    return { aliceSecret, bobSecret };
  }

  // Coin balance changes caused by `action`, one per player.
  async function coinChanges(players: Player[], action: () => Promise<unknown>) {
    const before = await Promise.all(players.map((player) => coin.balanceOf(player.address)));
    await action();
    const after = await Promise.all(players.map((player) => coin.balanceOf(player.address)));
    return after.map((value, index) => value - before[index]);
  }

  return { coin, cards, arena, owner, alice, bob, carol, mint, commit, startBattle, coinChanges };
}

// A card as a struct for battlePower and attackMultiplier.
function card(element: number, secondElement: number, power: number, passive = Passive.None) {
  return { speciesId: 0, element, secondElement, rarity: 0, power, passive, gender: MALE, generation: 0, breedReadyAt: 0 };
}

describe("Arena", function () {
  describe("helpers", function () {
    it("points at the ElementCards and GameCoin contracts", async function () {
      const { coin, cards, arena } = await deployArena();
      expect(await arena.cards()).to.equal(await cards.getAddress());
      expect(await arena.coin()).to.equal(await coin.getAddress());
    });

    it("computes the same commitment the frontend builds with ethers", async function () {
      const { arena, alice } = await deployArena();
      const tokenId = 7n;
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const expected = ethers.solidityPackedKeccak256(
        ["uint256", "bytes32", "address"],
        [tokenId, salt, alice.address],
      );
      expect(await arena.computeCommitment(tokenId, salt, alice.address)).to.equal(expected);
    });

    it("reverts getBattle for a battle that does not exist", async function () {
      const { arena } = await deployArena();
      await expect(arena.getBattle(1)).to.be.revertedWithCustomError(arena, "BattleNotFound").withArgs(1n);
    });
  });

  describe("element chart", function () {
    it("has exactly the published strengths", async function () {
      const { arena } = await deployArena();
      const { Neutral, Fire, Water, Grass, Electric, Ground, Ice, Dragon, Dark } = Element;
      const strengths = new Set(
        [
          [Water, Fire],
          [Fire, Grass],
          [Fire, Ice],
          [Grass, Ground],
          [Ground, Electric],
          [Electric, Water],
          [Ice, Dragon],
          [Dragon, Dark],
          [Dark, Neutral],
        ].map(([a, d]) => `${a}-${d}`),
      );

      for (const attacker of Object.values(Element)) {
        for (const defender of Object.values(Element)) {
          expect(await arena.beats(attacker, defender), `${attacker} vs ${defender}`).to.equal(
            strengths.has(`${attacker}-${defender}`),
          );
        }
      }
    });

    it("deals 2x when strong, 0.5x when resisted and 1x otherwise", async function () {
      const { arena } = await deployArena();
      expect(await arena.elementMultiplier(Element.Water, Element.Fire)).to.equal(200n);
      expect(await arena.elementMultiplier(Element.Fire, Element.Water)).to.equal(50n);
      expect(await arena.elementMultiplier(Element.Fire, Element.Fire)).to.equal(100n);
      expect(await arena.elementMultiplier(Element.Fire, Element.Dark)).to.equal(100n);
    });

    it("lets Neutral attack everything at 1x while Dark is strong against it", async function () {
      const { arena } = await deployArena();
      for (const defender of Object.values(Element)) {
        expect(await arena.elementMultiplier(Element.Neutral, defender)).to.equal(100n);
      }
      expect(await arena.elementMultiplier(Element.Dark, Element.Neutral)).to.equal(200n);
    });

    it("multiplies both elements of a dual-element defender", async function () {
      const { arena } = await deployArena();
      const fire = card(Element.Fire, Element.Fire, 20);
      expect(await arena.attackMultiplier(fire, card(Element.Grass, Element.Ice, 20))).to.equal(400n);
      expect(await arena.attackMultiplier(fire, card(Element.Grass, Element.Water, 20))).to.equal(100n);
      expect(await arena.attackMultiplier(fire, card(Element.Grass, Element.Dark, 20))).to.equal(200n);
      expect(await arena.attackMultiplier(fire, card(Element.Water, Element.Dark, 20))).to.equal(50n);
    });

    it("attacks with only the first element of a dual-element attacker", async function () {
      const { arena } = await deployArena();
      const fireDragon = card(Element.Fire, Element.Dragon, 20);
      expect(await arena.attackMultiplier(fireDragon, card(Element.Dark, Element.Dark, 20))).to.equal(100n);
    });
  });

  describe("passives", function () {
    const fire = (passive = Passive.None, power = 40) => card(Element.Fire, Element.Fire, power, passive);

    it("applies no bonus without a passive", async function () {
      const { arena } = await deployArena();
      expect(await arena.battlePower(fire(), card(Element.Grass, Element.Grass, 40))).to.equal(80n);
      expect(await arena.battlePower(fire(), card(Element.Water, Element.Water, 40))).to.equal(20n);
    });

    it("Pierce removes a resisted attack's penalty but adds nothing else", async function () {
      const { arena } = await deployArena();
      expect(await arena.battlePower(fire(Passive.Pierce), card(Element.Water, Element.Water, 40))).to.equal(40n);
      expect(await arena.battlePower(fire(Passive.Pierce), card(Element.Grass, Element.Grass, 40))).to.equal(80n);
    });

    it("Underdog adds 30% only against a stronger card", async function () {
      const { arena } = await deployArena();
      const enemy = (power: number) => card(Element.Dark, Element.Dark, power);
      expect(await arena.battlePower(fire(Passive.Underdog), enemy(41))).to.equal(52n);
      expect(await arena.battlePower(fire(Passive.Underdog), enemy(40))).to.equal(40n);
    });

    it("Resonance adds 20% only when the cards share an element", async function () {
      const { arena } = await deployArena();
      expect(await arena.battlePower(fire(Passive.Resonance), card(Element.Fire, Element.Fire, 40))).to.equal(48n);
      expect(await arena.battlePower(fire(Passive.Resonance), card(Element.Dark, Element.Fire, 40))).to.equal(48n);
      expect(await arena.battlePower(fire(Passive.Resonance), card(Element.Dark, Element.Dark, 40))).to.equal(40n);
    });

    it("Guard adds 25% only when the enemy is strong against the card", async function () {
      const { arena } = await deployArena();
      // Water is strong against Fire, and Fire's own attack on Water is halved.
      expect(await arena.battlePower(fire(Passive.Guard), card(Element.Water, Element.Water, 40))).to.equal(25n);
      expect(await arena.battlePower(fire(Passive.Guard), card(Element.Dark, Element.Dark, 40))).to.equal(40n);
    });

    it("Focus always adds 10%", async function () {
      const { arena } = await deployArena();
      expect(await arena.battlePower(fire(Passive.Focus), card(Element.Dark, Element.Dark, 40))).to.equal(44n);
    });
  });

  describe("battle flow", function () {
    it("createBattle takes the stake and stores the commitment", async function () {
      const { coin, arena, alice, mint, commit, coinChanges } = await deployArena();
      const { commitment } = commit(alice, await mint(alice, [Species.Emberkit, 20]));

      const [change] = await coinChanges([alice], async () => {
        await expect(arena.connect(alice).createBattle(commitment, STAKE))
          .to.emit(arena, "BattleCreated")
          .withArgs(1n, alice.address, STAKE);
      });

      expect(change).to.equal(-STAKE);
      expect(await coin.balanceOf(await arena.getAddress())).to.equal(STAKE);
      const battle = await arena.getBattle(1);
      expect(battle.creator).to.equal(alice.address);
      expect(battle.stake).to.equal(STAKE);
      expect(battle.creatorCommitment).to.equal(commitment);
      expect(battle.status).to.equal(Status.Open);
      expect(await arena.battleCount()).to.equal(1n);
    });

    it("createBattle and joinBattle revert without enough coins", async function () {
      const { coin, arena, alice, owner, mint, commit } = await deployArena();
      const { commitment } = commit(owner, await mint(owner, [Species.Emberkit, 20]));
      await expect(arena.connect(owner).createBattle(commitment, STAKE)).to.be.revertedWithCustomError(
        coin,
        "ERC20InsufficientBalance",
      );

      const aliceSecret = commit(alice, await mint(alice, [Species.Emberkit, 20]));
      await arena.connect(alice).createBattle(aliceSecret.commitment, STAKE);
      await expect(arena.connect(owner).joinBattle(1, commitment)).to.be.revertedWithCustomError(
        coin,
        "ERC20InsufficientBalance",
      );
    });

    it("joinBattle takes the same stake and sets the reveal deadline", async function () {
      const { arena, alice, bob, carol, mint, commit, coinChanges } = await deployArena();
      const aliceSecret = commit(alice, await mint(alice, [Species.Emberkit, 20]));
      const bobSecret = commit(bob, await mint(bob, [Species.Ripplet, 20]));
      await arena.connect(alice).createBattle(aliceSecret.commitment, STAKE);

      await expect(arena.connect(bob).joinBattle(2, bobSecret.commitment))
        .to.be.revertedWithCustomError(arena, "BattleNotFound")
        .withArgs(2n);

      const joinTime = (await networkHelpers.time.latest()) + 1;
      await networkHelpers.time.setNextBlockTimestamp(joinTime);
      const [change] = await coinChanges([bob], async () => {
        await expect(arena.connect(bob).joinBattle(1, bobSecret.commitment))
          .to.emit(arena, "BattleJoined")
          .withArgs(1n, bob.address, joinTime + REVEAL_WINDOW);
      });
      expect(change).to.equal(-STAKE);

      const battle = await arena.getBattle(1);
      expect(battle.opponent).to.equal(bob.address);
      expect(battle.opponentCommitment).to.equal(bobSecret.commitment);
      expect(battle.revealDeadline).to.equal(BigInt(joinTime + REVEAL_WINDOW));
      expect(battle.status).to.equal(Status.Joined);

      // A battle takes exactly one opponent.
      await expect(arena.connect(carol).joinBattle(1, bobSecret.commitment))
        .to.be.revertedWithCustomError(arena, "InvalidStatus")
        .withArgs(Status.Joined);
    });

    it("joinBattle rejects the creator joining their own battle", async function () {
      const { arena, alice, mint, commit } = await deployArena();
      const { commitment } = commit(alice, await mint(alice, [Species.Emberkit, 20]));
      await arena.connect(alice).createBattle(commitment, STAKE);

      await expect(arena.connect(alice).joinBattle(1, commitment)).to.be.revertedWithCustomError(
        arena,
        "CannotJoinOwnBattle",
      );
    });

    it("reveal rejects a salt or card that does not match the commitment", async function () {
      const { arena, alice, carol, mint, startBattle } = await deployArena();
      const { aliceSecret } = await startBattle([Species.Emberkit, 20], [Species.Ripplet, 20]);
      const otherCard = await mint(alice, [Species.Sproutle, 30]);
      const wrongSalt = ethers.hexlify(ethers.randomBytes(32));

      await expect(
        arena.connect(alice).reveal(1, aliceSecret.tokenId, wrongSalt),
      ).to.be.revertedWithCustomError(arena, "CommitmentMismatch");
      await expect(
        arena.connect(alice).reveal(1, otherCard, aliceSecret.salt),
      ).to.be.revertedWithCustomError(arena, "CommitmentMismatch");
      // Someone else cannot reveal even with the right secret.
      await expect(
        arena.connect(carol).reveal(1, aliceSecret.tokenId, aliceSecret.salt),
      ).to.be.revertedWithCustomError(arena, "NotPlayer");

      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);
      await expect(
        arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt),
      ).to.be.revertedWithCustomError(arena, "AlreadyRevealed");
    });

    it("reveal rejects a card the player no longer owns or has decomposed", async function () {
      const { cards, arena, alice, bob, carol, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Emberkit, 20], [Species.Ripplet, 20]);

      await cards.connect(alice).transferFrom(alice.address, carol.address, aliceSecret.tokenId);
      await expect(arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt))
        .to.be.revertedWithCustomError(arena, "NotCardOwner")
        .withArgs(aliceSecret.tokenId);

      await cards.connect(bob).decompose(bobSecret.tokenId);
      await expect(arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt)).to.be.revertedWithCustomError(
        cards,
        "ERC721NonexistentToken",
      );
    });

    it("the second reveal pays 2x stake to the stronger card", async function () {
      const { coin, arena, alice, bob, startBattle, coinChanges } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Emberkit, 30], [Species.Emberkit, 25]);

      await expect(arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt))
        .to.emit(arena, "CardRevealed")
        .withArgs(1n, alice.address, aliceSecret.tokenId);

      const changes = await coinChanges([alice, bob], async () => {
        await expect(arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt))
          .to.emit(arena, "BattleResolved")
          .withArgs(1n, alice.address, STAKE * 2n);
      });
      expect(changes).to.deep.equal([STAKE * 2n, 0n]);
      expect(await coin.balanceOf(await arena.getAddress())).to.equal(0n);

      const battle = await arena.getBattle(1);
      expect(battle.status).to.equal(Status.Resolved);
      expect(battle.winner).to.equal(alice.address);
      expect(battle.creatorTokenId).to.equal(aliceSecret.tokenId);
      expect(battle.opponentTokenId).to.equal(bobSecret.tokenId);
    });

    it("the element chart and passives decide the winner", async function () {
      async function winnerOf(aliceCard: CardSpec, bobCard: CardSpec) {
        const { arena, alice, bob, startBattle } = await deployArena();
        const { aliceSecret, bobSecret } = await startBattle(aliceCard, bobCard);
        await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);
        await arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt);
        const { winner } = await arena.getBattle(1);
        return winner === alice.address ? "alice" : winner === bob.address ? "bob" : "draw";
      }

      // Fire 20 hits Grass at 40; Grass 39 hits Fire at 19.
      expect(await winnerOf([Species.Emberkit, 20], [Species.Sproutle, 39])).to.equal("alice");
      // Neutral 30 attacks Dark at 30, while Dark 20 hits Neutral at 40.
      expect(await winnerOf([Species.Puffkin, 30], [Species.Gloomlet, 20])).to.equal("bob");
      // Equal Fire cards draw, unless Focus lifts one of them above the other.
      expect(await winnerOf([Species.Emberkit, 30], [Species.Emberkit, 30])).to.equal("draw");
      expect(await winnerOf([Species.Emberkit, 30, Passive.Focus], [Species.Emberkit, 30])).to.equal("alice");
    });

    it("a tie refunds both players", async function () {
      const { arena, alice, bob, startBattle, coinChanges } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Emberkit, 20], [Species.Emberkit, 20]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);

      const changes = await coinChanges([alice, bob], async () => {
        await expect(arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt))
          .to.emit(arena, "BattleResolved")
          .withArgs(1n, ethers.ZeroAddress, STAKE);
      });
      expect(changes).to.deep.equal([STAKE, STAKE]);
      expect((await arena.getBattle(1)).winner).to.equal(ethers.ZeroAddress);
    });

    it("resolves with the card as revealed, even if it is decomposed afterwards", async function () {
      const { cards, arena, alice, bob, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Emberkit, 30], [Species.Emberkit, 25]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);
      await cards.connect(alice).decompose(aliceSecret.tokenId);

      await arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt);
      expect((await arena.getBattle(1)).winner).to.equal(alice.address);
    });

    it("uses the passive the card had when it was revealed", async function () {
      const { cards, arena, alice, bob, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Emberkit, 30], [Species.Emberkit, 30]);

      // Enchanting after the reveal changes the card but not the battle.
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);
      await cards.connect(alice).enchant(aliceSecret.tokenId);
      await arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt);

      const [creatorCard] = await arena.getRevealedCards(1);
      expect(creatorCard.passive).to.equal(BigInt(Passive.None));
      expect((await arena.getBattle(1)).winner).to.equal(ethers.ZeroAddress);
    });

    it("claimTimeout gives the pot to the only player who revealed", async function () {
      const { arena, alice, bob, carol, startBattle, coinChanges } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Emberkit, 10], [Species.Emberkit, 39]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);

      await expect(arena.connect(carol).claimTimeout(1)).to.be.revertedWithCustomError(arena, "RevealWindowOpen");

      await networkHelpers.time.increase(REVEAL_WINDOW + 1);
      await expect(
        arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt),
      ).to.be.revertedWithCustomError(arena, "RevealWindowClosed");

      // Anyone may settle; the pot still goes to the player who revealed.
      const changes = await coinChanges([alice, bob], async () => {
        await expect(arena.connect(carol).claimTimeout(1))
          .to.emit(arena, "BattleResolved")
          .withArgs(1n, alice.address, STAKE * 2n);
      });
      expect(changes).to.deep.equal([STAKE * 2n, 0n]);
      expect((await arena.getBattle(1)).status).to.equal(Status.Resolved);
    });

    it("claimTimeout refunds both players when nobody revealed", async function () {
      const { arena, alice, bob, startBattle, coinChanges } = await deployArena();
      await startBattle([Species.Emberkit, 20], [Species.Ripplet, 20]);
      await networkHelpers.time.increase(REVEAL_WINDOW + 1);

      const changes = await coinChanges([alice, bob], async () => {
        await expect(arena.connect(alice).claimTimeout(1))
          .to.emit(arena, "BattleResolved")
          .withArgs(1n, ethers.ZeroAddress, STAKE);
      });
      expect(changes).to.deep.equal([STAKE, STAKE]);
    });

    it("cancelBattle refunds the creator while the battle is still open", async function () {
      const { arena, alice, bob, mint, commit, coinChanges } = await deployArena();
      const { commitment } = commit(alice, await mint(alice, [Species.Emberkit, 20]));
      await arena.connect(alice).createBattle(commitment, STAKE);

      await expect(arena.connect(bob).cancelBattle(1)).to.be.revertedWithCustomError(arena, "NotCreator");

      const [change] = await coinChanges([alice], async () => {
        await expect(arena.connect(alice).cancelBattle(1)).to.emit(arena, "BattleCancelled").withArgs(1n);
      });
      expect(change).to.equal(STAKE);
      expect((await arena.getBattle(1)).status).to.equal(Status.Cancelled);

      await expect(arena.connect(bob).joinBattle(1, commitment))
        .to.be.revertedWithCustomError(arena, "InvalidStatus")
        .withArgs(Status.Cancelled);
    });

    it("battlesOf lists every battle a player created or joined", async function () {
      const { arena, alice, bob, carol, mint, commit } = await deployArena();
      const aliceCommitment = commit(alice, await mint(alice, [Species.Emberkit, 20])).commitment;
      const bobCommitment = commit(bob, await mint(bob, [Species.Ripplet, 20])).commitment;
      await arena.connect(alice).createBattle(aliceCommitment, 0);
      await arena.connect(bob).createBattle(bobCommitment, 0);
      await arena.connect(alice).joinBattle(2, aliceCommitment);

      expect(await arena.battlesOf(alice.address)).to.deep.equal([1n, 2n]);
      expect(await arena.battlesOf(bob.address)).to.deep.equal([2n]);
      expect(await arena.battlesOf(carol.address)).to.deep.equal([]);
    });

    it("getRevealedCards keeps the revealed cards after they are gone", async function () {
      const { cards, arena, alice, bob, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Emberkit, 30], [Species.Sproutle, 25]);

      // Nothing revealed yet: both sides are zeroed.
      let [creatorCard, opponentCard] = await arena.getRevealedCards(1);
      expect(creatorCard.power).to.equal(0n);
      expect(opponentCard.power).to.equal(0n);

      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);
      await arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt);
      await cards.connect(alice).decompose(aliceSecret.tokenId);

      [creatorCard, opponentCard] = await arena.getRevealedCards(1);
      expect([creatorCard.speciesId, creatorCard.power]).to.deep.equal([BigInt(Species.Emberkit), 30n]);
      expect([opponentCard.speciesId, opponentCard.power]).to.deep.equal([BigInt(Species.Sproutle), 25n]);
      await expect(arena.getRevealedCards(2)).to.be.revertedWithCustomError(arena, "BattleNotFound").withArgs(2n);
    });

    it("plays a friendly match with no stake", async function () {
      const { arena, alice, bob, startBattle, coinChanges } = await deployArena();
      // Grass 10 is weak against Fire 25, which hits Grass at double power.
      const { aliceSecret, bobSecret } = await startBattle([Species.Emberkit, 25], [Species.Sproutle, 10], 0n);
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);

      const changes = await coinChanges([alice, bob], async () => {
        await expect(arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt))
          .to.emit(arena, "BattleResolved")
          .withArgs(1n, alice.address, 0n);
      });
      expect(changes).to.deep.equal([0n, 0n]);
    });
  });
});
