import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const Element = { Fire: 0, Water: 1, Wood: 2 };
const Rarity = { Common: 0, Rare: 1, Legendary: 2 };
const Status = { None: 0n, Open: 1n, Joined: 2n, Resolved: 3n, Cancelled: 4n };
const STAKE = ethers.parseEther("0.01");
const REVEAL_WINDOW = 600;

type Player = { address: string };

async function deployArena() {
  const [owner, alice, bob, carol] = await ethers.getSigners();
  // The mock mints cards with chosen attributes, so each matchup is exact.
  const cards = await ethers.deployContract("MockElementCards");
  const arena = await ethers.deployContract("Arena", [await cards.getAddress()]);

  async function mint(to: Player, element: number, power: number) {
    const tokenId = await cards.mintCard.staticCall(to.address, element, Rarity.Common, power);
    await cards.mintCard(to.address, element, Rarity.Common, power);
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
  async function startBattle(aliceCard: [number, number], bobCard: [number, number], stake = STAKE) {
    const aliceSecret = commit(alice, await mint(alice, ...aliceCard));
    const bobSecret = commit(bob, await mint(bob, ...bobCard));
    await arena.connect(alice).createBattle(aliceSecret.commitment, { value: stake });
    await arena.connect(bob).joinBattle(1, bobSecret.commitment, { value: stake });
    return { aliceSecret, bobSecret };
  }

  return { cards, arena, owner, alice, bob, carol, mint, commit, startBattle };
}

describe("Arena", function () {
  describe("helpers", function () {
    it("points at the ElementCards contract", async function () {
      const { cards, arena } = await deployArena();
      expect(await arena.cards()).to.equal(await cards.getAddress());
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

    it("implements the element triangle Fire > Wood > Water > Fire", async function () {
      const { arena } = await deployArena();
      expect(await arena.beats(Element.Fire, Element.Wood)).to.equal(true);
      expect(await arena.beats(Element.Wood, Element.Water)).to.equal(true);
      expect(await arena.beats(Element.Water, Element.Fire)).to.equal(true);
      expect(await arena.beats(Element.Wood, Element.Fire)).to.equal(false);
      expect(await arena.beats(Element.Fire, Element.Fire)).to.equal(false);
    });

    it("reverts getBattle for a battle that does not exist", async function () {
      const { arena } = await deployArena();
      await expect(arena.getBattle(1)).to.be.revertedWithCustomError(arena, "BattleNotFound").withArgs(1n);
    });
  });

  describe("battle flow", function () {
    it("createBattle stores the stake and commitment and emits BattleCreated", async function () {
      const { arena, alice, mint, commit } = await deployArena();
      const { commitment } = commit(alice, await mint(alice, Element.Fire, 20));

      await expect(arena.connect(alice).createBattle(commitment, { value: STAKE }))
        .to.emit(arena, "BattleCreated")
        .withArgs(1n, alice.address, STAKE);

      const battle = await arena.getBattle(1);
      expect(battle.creator).to.equal(alice.address);
      expect(battle.stake).to.equal(STAKE);
      expect(battle.creatorCommitment).to.equal(commitment);
      expect(battle.status).to.equal(Status.Open);
      expect(await arena.battleCount()).to.equal(1n);
      expect(await ethers.provider.getBalance(arena)).to.equal(STAKE);
    });

    it("joinBattle requires the same stake and sets the reveal deadline", async function () {
      const { arena, alice, bob, carol, mint, commit } = await deployArena();
      const aliceSecret = commit(alice, await mint(alice, Element.Fire, 20));
      const bobSecret = commit(bob, await mint(bob, Element.Water, 20));
      await arena.connect(alice).createBattle(aliceSecret.commitment, { value: STAKE });

      await expect(arena.connect(bob).joinBattle(1, bobSecret.commitment, { value: STAKE / 2n }))
        .to.be.revertedWithCustomError(arena, "StakeMismatch")
        .withArgs(STAKE / 2n, STAKE);
      await expect(arena.connect(bob).joinBattle(2, bobSecret.commitment, { value: STAKE }))
        .to.be.revertedWithCustomError(arena, "BattleNotFound")
        .withArgs(2n);

      const joinTime = (await networkHelpers.time.latest()) + 1;
      await networkHelpers.time.setNextBlockTimestamp(joinTime);
      await expect(arena.connect(bob).joinBattle(1, bobSecret.commitment, { value: STAKE }))
        .to.emit(arena, "BattleJoined")
        .withArgs(1n, bob.address, joinTime + REVEAL_WINDOW);

      const battle = await arena.getBattle(1);
      expect(battle.opponent).to.equal(bob.address);
      expect(battle.opponentCommitment).to.equal(bobSecret.commitment);
      expect(battle.revealDeadline).to.equal(BigInt(joinTime + REVEAL_WINDOW));
      expect(battle.status).to.equal(Status.Joined);

      // A battle takes exactly one opponent.
      await expect(arena.connect(carol).joinBattle(1, bobSecret.commitment, { value: STAKE }))
        .to.be.revertedWithCustomError(arena, "InvalidStatus")
        .withArgs(Status.Joined);
    });

    it("joinBattle rejects the creator joining their own battle", async function () {
      const { arena, alice, mint, commit } = await deployArena();
      const { commitment } = commit(alice, await mint(alice, Element.Fire, 20));
      await arena.connect(alice).createBattle(commitment, { value: STAKE });

      await expect(
        arena.connect(alice).joinBattle(1, commitment, { value: STAKE }),
      ).to.be.revertedWithCustomError(arena, "CannotJoinOwnBattle");
    });

    it("reveal rejects a salt or card that does not match the commitment", async function () {
      const { arena, alice, carol, mint, startBattle } = await deployArena();
      const { aliceSecret } = await startBattle([Element.Fire, 20], [Element.Water, 20]);
      const otherCard = await mint(alice, Element.Wood, 30);
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

    it("reveal rejects a card the player no longer owns", async function () {
      const { cards, arena, alice, carol, startBattle } = await deployArena();
      const { aliceSecret } = await startBattle([Element.Fire, 20], [Element.Water, 20]);
      await cards.connect(alice).transferFrom(alice.address, carol.address, aliceSecret.tokenId);

      await expect(arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt))
        .to.be.revertedWithCustomError(arena, "NotCardOwner")
        .withArgs(aliceSecret.tokenId);
    });

    it("the second reveal pays 2x stake to the stronger card", async function () {
      const { arena, alice, bob, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Element.Fire, 30], [Element.Fire, 25]);

      await expect(arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt))
        .to.emit(arena, "CardRevealed")
        .withArgs(1n, alice.address, aliceSecret.tokenId);

      const secondReveal = arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt);
      await expect(secondReveal).to.emit(arena, "BattleResolved").withArgs(1n, alice.address, STAKE * 2n);
      await expect(secondReveal).to.changeEtherBalances(ethers, [alice, bob, arena], [STAKE * 2n, 0n, -STAKE * 2n]);

      const battle = await arena.getBattle(1);
      expect(battle.status).to.equal(Status.Resolved);
      expect(battle.winner).to.equal(alice.address);
      expect(battle.creatorTokenId).to.equal(aliceSecret.tokenId);
      expect(battle.opponentTokenId).to.equal(bobSecret.tokenId);
    });

    it("element advantage multiplies power by 1.5", async function () {
      // Fire 20 fights Wood at 30, beating Wood 29.
      const first = await deployArena();
      const battle1 = await first.startBattle([Element.Fire, 20], [Element.Wood, 29]);
      await first.arena.connect(first.bob).reveal(1, battle1.bobSecret.tokenId, battle1.bobSecret.salt);
      await first.arena.connect(first.alice).reveal(1, battle1.aliceSecret.tokenId, battle1.aliceSecret.salt);
      expect((await first.arena.getBattle(1)).winner).to.equal(first.alice.address);

      // Water 20 fights Fire at 30, which is not enough against Fire 31.
      const second = await deployArena();
      const battle2 = await second.startBattle([Element.Water, 20], [Element.Fire, 31]);
      await second.arena.connect(second.alice).reveal(1, battle2.aliceSecret.tokenId, battle2.aliceSecret.salt);
      await second.arena.connect(second.bob).reveal(1, battle2.bobSecret.tokenId, battle2.bobSecret.salt);
      expect((await second.arena.getBattle(1)).winner).to.equal(second.bob.address);
    });

    it("a tie refunds both players", async function () {
      const { arena, alice, bob, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Element.Fire, 20], [Element.Fire, 20]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);

      const secondReveal = arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt);
      await expect(secondReveal).to.emit(arena, "BattleResolved").withArgs(1n, ethers.ZeroAddress, STAKE);
      await expect(secondReveal).to.changeEtherBalances(ethers, [alice, bob, arena], [STAKE, STAKE, -STAKE * 2n]);
      expect((await arena.getBattle(1)).winner).to.equal(ethers.ZeroAddress);
    });

    it("resolves with the revealed card even if it changes hands afterwards", async function () {
      const { cards, arena, alice, bob, carol, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Element.Fire, 30], [Element.Fire, 25]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);
      await cards.connect(alice).transferFrom(alice.address, carol.address, aliceSecret.tokenId);

      await arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt);
      expect((await arena.getBattle(1)).winner).to.equal(alice.address);
    });

    it("claimTimeout gives the pot to the only player who revealed", async function () {
      const { arena, alice, bob, carol, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Element.Fire, 10], [Element.Fire, 39]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);

      await expect(arena.connect(carol).claimTimeout(1)).to.be.revertedWithCustomError(arena, "RevealWindowOpen");

      await networkHelpers.time.increase(REVEAL_WINDOW + 1);
      await expect(
        arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt),
      ).to.be.revertedWithCustomError(arena, "RevealWindowClosed");

      // Anyone may settle; the pot still goes to the player who revealed.
      const claim = arena.connect(carol).claimTimeout(1);
      await expect(claim).to.emit(arena, "BattleResolved").withArgs(1n, alice.address, STAKE * 2n);
      await expect(claim).to.changeEtherBalances(ethers, [alice, bob], [STAKE * 2n, 0n]);
      expect((await arena.getBattle(1)).status).to.equal(Status.Resolved);
    });

    it("claimTimeout refunds both players when nobody revealed", async function () {
      const { arena, alice, bob, startBattle } = await deployArena();
      await startBattle([Element.Fire, 20], [Element.Water, 20]);
      await networkHelpers.time.increase(REVEAL_WINDOW + 1);

      const claim = arena.connect(alice).claimTimeout(1);
      await expect(claim).to.emit(arena, "BattleResolved").withArgs(1n, ethers.ZeroAddress, STAKE);
      await expect(claim).to.changeEtherBalances(ethers, [alice, bob, arena], [STAKE, STAKE, -STAKE * 2n]);
    });

    it("cancelBattle refunds the creator while the battle is still open", async function () {
      const { arena, alice, bob, mint, commit } = await deployArena();
      const { commitment } = commit(alice, await mint(alice, Element.Fire, 20));
      await arena.connect(alice).createBattle(commitment, { value: STAKE });

      await expect(arena.connect(bob).cancelBattle(1)).to.be.revertedWithCustomError(arena, "NotCreator");

      const cancel = arena.connect(alice).cancelBattle(1);
      await expect(cancel).to.emit(arena, "BattleCancelled").withArgs(1n);
      await expect(cancel).to.changeEtherBalances(ethers, [alice, arena], [STAKE, -STAKE]);
      expect((await arena.getBattle(1)).status).to.equal(Status.Cancelled);

      await expect(arena.connect(bob).joinBattle(1, commitment, { value: STAKE }))
        .to.be.revertedWithCustomError(arena, "InvalidStatus")
        .withArgs(Status.Cancelled);
    });

    it("battlesOf lists every battle a player created or joined", async function () {
      const { arena, alice, bob, carol, mint, commit } = await deployArena();
      const aliceCommitment = commit(alice, await mint(alice, Element.Fire, 20)).commitment;
      const bobCommitment = commit(bob, await mint(bob, Element.Water, 20)).commitment;
      await arena.connect(alice).createBattle(aliceCommitment);
      await arena.connect(bob).createBattle(bobCommitment);
      await arena.connect(alice).joinBattle(2, aliceCommitment);

      expect(await arena.battlesOf(alice.address)).to.deep.equal([1n, 2n]);
      expect(await arena.battlesOf(bob.address)).to.deep.equal([2n]);
      expect(await arena.battlesOf(carol.address)).to.deep.equal([]);
    });

    it("getRevealedCards keeps the revealed cards after they are gone", async function () {
      const { cards, arena, alice, bob, carol, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Element.Fire, 30], [Element.Wood, 25]);

      // Nothing revealed yet: both sides are zeroed.
      let [creatorCard, opponentCard] = await arena.getRevealedCards(1);
      expect(creatorCard.power).to.equal(0n);
      expect(opponentCard.power).to.equal(0n);

      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);
      await arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt);
      await cards.connect(alice).transferFrom(alice.address, carol.address, aliceSecret.tokenId);

      [creatorCard, opponentCard] = await arena.getRevealedCards(1);
      expect([creatorCard.element, creatorCard.power]).to.deep.equal([BigInt(Element.Fire), 30n]);
      expect([opponentCard.element, opponentCard.power]).to.deep.equal([BigInt(Element.Wood), 25n]);
      await expect(arena.getRevealedCards(2)).to.be.revertedWithCustomError(arena, "BattleNotFound").withArgs(2n);
    });

    it("plays a friendly match with no stake", async function () {
      const { arena, alice, bob, startBattle } = await deployArena();
      // Wood 25 fights Water at 37, beating Water 30.
      const { aliceSecret, bobSecret } = await startBattle([Element.Wood, 25], [Element.Water, 30], 0n);
      await arena.connect(alice).reveal(1, aliceSecret.tokenId, aliceSecret.salt);

      await expect(arena.connect(bob).reveal(1, bobSecret.tokenId, bobSecret.salt))
        .to.emit(arena, "BattleResolved")
        .withArgs(1n, alice.address, 0n);
    });
  });
});
