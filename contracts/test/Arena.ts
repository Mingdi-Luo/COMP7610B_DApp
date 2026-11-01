import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const Element = { Fire: 0, Water: 1, Wood: 2 };

async function deployArena() {
  const [owner, alice, bob] = await ethers.getSigners();
  const cards = await ethers.deployContract("ElementCards");
  const arena = await ethers.deployContract("Arena", [await cards.getAddress()]);
  return { cards, arena, owner, alice, bob };
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
      await expect(arena.getBattle(1)).to.be.revertedWithCustomError(arena, "BattleNotFound");
    });
  });

  // Specs for the TODO functions. Turn each into a real test while implementing.
  describe("battle flow (TODO)", function () {
    it("createBattle stores the stake and commitment and emits BattleCreated");
    it("joinBattle requires the same stake and sets the reveal deadline");
    it("joinBattle rejects the creator joining their own battle");
    it("reveal rejects a salt or card that does not match the commitment");
    it("reveal rejects a card the player no longer owns");
    it("the second reveal pays 2x stake to the stronger card");
    it("element advantage multiplies power by 1.5");
    it("a tie refunds both players");
    it("claimTimeout gives the pot to the only player who revealed");
    it("claimTimeout refunds both players when nobody revealed");
    it("cancelBattle refunds the creator while the battle is still open");
  });
});
