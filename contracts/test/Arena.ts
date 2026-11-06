import { SPECIES } from "../../frontend/src/config/species.js";
import { battleBreakdown, simulateBattle, simulateTeamBattle, elementMultiplier, attackMultiplier } from "../../frontend/src/lib/cards.js";
import { computeCommitment as frontendCommitment, saveSecret, loadSecret } from "../../frontend/src/lib/commitment.js";
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const Element = { Neutral: 0, Fire: 1, Water: 2, Grass: 3, Electric: 4, Ground: 5, Ice: 6, Dragon: 7, Dark: 8, None: 9 };
const Passive = { None: 0, Pierce: 1, Underdog: 2, Resonance: 3, Guard: 4, Focus: 5 };
const MALE = 0;
const Status = { None: 0n, Open: 1n, Joined: 2n, Resolved: 3n, Cancelled: 4n };
const Species = Object.fromEntries(SPECIES.map((pal) => [pal.nameEn.replaceAll(" ", ""), pal.speciesId]));
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
    const ids: bigint[] = [];
    for (let i = 0; i < 3; i++) {
      const tokenId = await cards.mintCard.staticCall(to.address, speciesId, power, passive, MALE);
      await cards.mintCard(to.address, speciesId, power, passive, MALE);
      ids.push(tokenId);
    }
    return ids;
  }

  // Same hash as frontend/src/lib/commitment.js.
  function commit(player: Player, tokenIds: bigint[]) {
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const commitment = ethers.solidityPackedKeccak256(
      ["uint256[3]", "bytes32", "address"],
      [tokenIds, salt, player.address],
    );
    return { tokenIds, salt, commitment };
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

// Synthetic combat card for boundary cases.
function card(element: number, secondElement: number, power: number, passive = Passive.None) {
  return { speciesId: 0, element, secondElement, rarity: 0, power, passive, gender: MALE, generation: 0, breedReadyAt: 0, maxHP: 100, atk: power, def: 100 };
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
      const tokenIds = [7n, 8n, 9n];
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const expected = ethers.solidityPackedKeccak256(
        ["uint256[3]", "bytes32", "address"],
        [tokenIds, salt, alice.address],
      );
      expect(await arena.computeCommitment(tokenIds, salt, alice.address)).to.equal(expected);
    });

    it("reverts getBattle for a battle that does not exist", async function () {
      const { arena } = await deployArena();
      await expect(arena.getBattle(1)).to.be.revertedWithCustomError(arena, "BattleNotFound").withArgs(1n);
    });
  });

  describe("deterministic combat", function () {
    it("has exactly the published strengths and reverse resistances, including Neutral vs Dark", async function () {
      const { arena } = await deployArena();
      const strengths = new Set(["2-1", "1-3", "1-6", "3-5", "5-4", "4-2", "6-7", "7-8", "8-0"]);
      for (const attacker of Object.values(Element)) {
        for (const defender of Object.values(Element)) {
          expect(await arena.beats(attacker, defender)).to.equal(strengths.has(`${attacker}-${defender}`));
          const expected = attacker === 9 || defender === 9 ? 10000 : strengths.has(`${attacker}-${defender}`) ? 12500 : strengths.has(`${defender}-${attacker}`) ? 8000 : 10000;
          expect(await arena.elementMultiplier(attacker, defender)).to.equal(BigInt(expected));
          expect(elementMultiplier(attacker, defender)).to.equal(expected);
        }
      }
    });

    it("multiplies defense elements before clamping, ignores None, and attacks only with the primary element", async function () {
      const { arena } = await deployArena();
      const fire = card(Element.Fire, Element.Dragon, 100);
      const cases = [
        [Element.Grass, Element.Ice, 15000],
        [Element.Water, Element.Grass, 10000],
        [Element.Grass, Element.None, 12500],
        [Element.Dark, Element.None, 10000],
        [Element.Fire, Element.None, 10000],
      ];
      for (const [first, second, expected] of cases) {
        const defender = card(first, second, 100);
        expect(await arena.attackMultiplier(fire, defender)).to.equal(BigInt(expected));
        expect(attackMultiplier(fire, defender)).to.equal(expected);
      }
      // Synthetic repeated Water defense exercises the lower clamp: 0.8 * 0.8 -> 0.70.
      // Actual single-element species use None and never duplicate the primary element.
      const doubleResistance = card(Element.Water, Element.Water, 100);
      expect(await arena.attackMultiplier(fire, doubleResistance)).to.equal(7000n);
      expect(attackMultiplier(fire, doubleResistance)).to.equal(7000);
      expect(await arena.attackMultiplier(fire, card(Element.Water, Element.None, 100))).to.equal(8000n);
    });

    it("floors damage once at the final division and always deals at least one", async function () {
      const { arena } = await deployArena();
      const a = { ...card(Element.Fire, Element.None, 73), atk: 73 };
      const b = { ...card(Element.Grass, Element.None, 10), def: 87 };
      expect(await arena.damage(a, b)).to.equal(48n);
      expect(await arena.damage({ ...a, atk: 0 }, { ...b, def: 65535 })).to.equal(1n);
      expect(await arena.damage({ ...a, atk: 65535 }, { ...b, def: 0 })).to.equal(81918n);
    });

    it("does not use rarity, legacy power, gender or generation", async function () {
      const { arena } = await deployArena();
      const a = card(Element.Fire, Element.None, 100);
      const b = card(Element.Grass, Element.None, 100);
      const expected = await arena.simulateBattle(a, b);
      const changed = { ...a, rarity: 2, power: 1, gender: 1, generation: 255, breedReadyAt: 999999 };
      expect(await arena.simulateBattle(changed, b)).to.deep.equal(expected);
    });

    it("handles survival, simultaneous knockouts and the last-round ratio comparison", async function () {
      const { arena } = await deployArena();
      const base = card(Element.Neutral, Element.None, 100);
      const cases = [
        // Both attacks still land when A could KO B on this round.
        [{ ...base, maxHP: 50 }, { ...base, maxHP: 50 }, [0, 0, 1, 0]],
        [{ ...base, maxHP: 51 }, { ...base, maxHP: 50 }, [1, 0, 1, 1]],
        [{ ...base, maxHP: 50 }, { ...base, maxHP: 51 }, [0, 1, 1, 2]],
        // A has more absolute HP, but B has the greater HP fraction.
        [{ ...base, maxHP: 1000, atk: 2 }, { ...base, maxHP: 100, atk: 40 }, [600, 80, 20, 2]],
        // Different remaining HP, equal fractions -> draw.
        [{ ...base, maxHP: 1000, atk: 2 }, { ...base, maxHP: 100, atk: 20 }, [800, 80, 20, 0]],
        // Simultaneous KO on the last allowed round is still a draw.
        [{ ...base, maxHP: 20, atk: 4 }, { ...base, maxHP: 40, atk: 0 }, [0, 0, 20, 0]],
        // One survivor on round 20 wins immediately.
        [{ ...base, maxHP: 21, atk: 4 }, { ...base, maxHP: 40, atk: 0 }, [1, 0, 20, 1]],
      ];
      for (const [a, b, expected] of cases) {
        const result = await arena.simulateBattle(a, b);
        expect([result.hpA, result.hpB, result.rounds, result.winner]).to.deep.equal(expected.map(BigInt));
        const front = simulateBattle(a, b);
        expect([front.hpA, front.hpB, front.rounds, front.winner]).to.deep.equal(expected);
      }
    });

    it("matches the frontend and an independent closed-form result across all 136 species", async function () {
      const { arena } = await deployArena();
      for (const [i, species] of SPECIES.entries()) {
        const a = { ...card(species.element, species.secondElement, 1), ...species };
        const other = SPECIES[(i * 37 + 17) % SPECIES.length];
        const b = { ...card(other.element, other.secondElement, 255), ...other };
        const damageA = battleBreakdown(a, b).total;
        const damageB = battleBreakdown(b, a).total;
        const rounds = Math.min(20, Math.ceil(a.maxHP / damageB), Math.ceil(b.maxHP / damageA));
        const hpA = Math.max(0, a.maxHP - rounds * damageB);
        const hpB = Math.max(0, b.maxHP - rounds * damageA);
        const cmp = hpA === 0 || hpB === 0 ? hpA - hpB : hpA * b.maxHP - hpB * a.maxHP;
        const winner = cmp > 0 ? 1 : cmp < 0 ? 2 : 0;
        const result = await arena.simulateBattle(a, b);
        expect([result.hpA, result.hpB, result.damageA, result.damageB, result.rounds, result.winner]).to.deep.equal([hpA, hpB, damageA, damageB, rounds, winner].map(BigInt));
        const front = simulateBattle(a, b);
        expect([front.hpA, front.hpB, front.rounds, front.winner]).to.deep.equal([hpA, hpB, rounds, winner]);
      }
    });
  });

  describe("3v3 relay combat", function () {
    const base = { ...card(Element.Neutral, Element.None, 10), def: 0 };
    const team = (maxHP = 100, atk = 10) => Array.from({ length: 3 }, () => ({ ...base, maxHP, atk }));

    async function check(a, b, hpA, hpB, rounds, winner) {
      const { arena } = await deployArena();
      const onchain = await arena.simulateTeamBattle(a, b);
      const front = simulateTeamBattle(a, b);
      expect(Array.from(onchain.hpA)).to.deep.equal(hpA.map(BigInt));
      expect(Array.from(onchain.hpB)).to.deep.equal(hpB.map(BigInt));
      expect([onchain.rounds, onchain.winner]).to.deep.equal([BigInt(rounds), BigInt(winner)]);
      expect([front.hpA, front.hpB, front.rounds, front.winner]).to.deep.equal([hpA.map(BigInt), hpB.map(BigInt), rounds, winner]);
      return front;
    }

    it("carries survivor HP, replaces only next round, and never spills damage onto the bench", async function () {
      const result = await check(team(100, 60), team(50, 10), [70, 100, 100], [0, 0, 0], 3, 1);
      expect(result.log.map(row => [row.activeA, row.activeB])).to.deep.equal([[0, 0], [0, 1], [0, 2]]);
      expect(result.log[0].hpB).to.deep.equal([0n, 50n, 50n]);
    });

    it("double knockouts advance both teams and all six knocked out is a draw", async function () {
      const result = await check(team(10, 10), team(10, 10), [0, 0, 0], [0, 0, 0], 3, 0);
      expect(result.log.map(row => [row.activeA, row.activeB])).to.deep.equal([[0, 0], [1, 1], [2, 2]]);
    });

    it("recomputes damage when a different card replaces the fallen lead", async function () {
      const { arena } = await deployArena();
      const a = [{ ...base, maxHP: 10 }, { ...base, maxHP: 100, atk: 60 }, { ...base, maxHP: 100 }];
      const b = team(20, 10);
      const result = simulateTeamBattle(a, b);
      expect(result.log[0].activeA).to.equal(0);
      expect(result.log[1].activeA).to.equal(1);
      expect(result.log[1].damageA).to.equal(60n);
      const onchain = await arena.simulateTeamBattle(a, b);
      expect(Array.from(onchain.hpA)).to.deep.equal(result.hpA);
      expect(Array.from(onchain.hpB)).to.deep.equal(result.hpB);
      expect(onchain.winner).to.equal(BigInt(result.winner));
    });

    it("uses one global 20-round limit and compares summed HP fractions, including unused full-health cards", async function () {
      const a = team(100, 1); a[0].maxHP = 1000;
      await check(a, team(100, 20), [600, 100, 100], [80, 100, 100], 20, 2);
      await check(a, team(100, 10), [800, 100, 100], [80, 100, 100], 20, 0);
    });

    it("uses the bench fractions when more cards remain on one team", async function () {
      const a = team(1000, 1); a[0] = { ...base, maxHP: 10, atk: 20 };
      await check(a, team(1000, 10), [0, 810, 1000], [961, 1000, 1000], 20, 2);
    });

    it("does not round individual HP ratios and safely handles uint16 maximum stats", async function () {
      // The two lead ratios both display as 99.96%, but A is strictly larger.
      await check(team(65535, 1), team(65534, 1), [65515, 65535, 65535], [65514, 65534, 65534], 20, 1);
      const max = { ...base, maxHP: 65535, atk: 65535, def: 65535 };
      const { arena } = await deployArena();
      const a = [max, max, max]; const b = [{ ...max, maxHP: 65534 }, max, max];
      const front = simulateTeamBattle(a, b);
      const onchain = await arena.simulateTeamBattle(a, b);
      expect(Array.from(onchain.hpA)).to.deep.equal(front.hpA);
      expect(onchain.winner).to.equal(BigInt(front.winner));
      expect(typeof front.hpA[0]).to.equal("bigint");
    });

    it("handles a last-round KO and a last-round simultaneous team elimination", async function () {
      const a = team(10, 10); const b = team(10, 10);
      a[2] = { ...base, maxHP: 180, atk: 10 };
      b[2] = { ...base, maxHP: 180, atk: 10 };
      await check(a, b, [0, 0, 0], [0, 0, 0], 20, 0);
      a[2].maxHP = 181;
      await check(a, b, [0, 0, 1], [0, 0, 0], 20, 1);
    });

    it("rejects zero MaxHP and invalid frontend team lengths", async function () {
      const { arena } = await deployArena();
      const a = team(); a[1].maxHP = 0;
      await expect(arena.simulateTeamBattle(a, team())).to.be.revertedWithCustomError(arena, "InvalidCombatStats");
      expect(() => simulateTeamBattle(a, team())).to.throw("positive MaxHP");
      expect(() => simulateTeamBattle(team().slice(0, 2), team())).to.throw("three cards");
    });

    it("matches onchain and BigInt frontend results across 136 varied ordered teams", async function () {
      const { arena } = await deployArena();
      for (let i = 0; i < SPECIES.length; i++) {
        const a = [0, 1, 2].map(j => ({ ...base, ...SPECIES[(i + j * 13) % 136] }));
        const b = [0, 1, 2].map(j => ({ ...base, ...SPECIES[(i * 37 + j * 19 + 17) % 136] }));
        const result = simulateTeamBattle(a, b);
        const onchain = await arena.simulateTeamBattle(a, b);
        expect(Array.from(onchain.hpA)).to.deep.equal(result.hpA);
        expect(Array.from(onchain.hpB)).to.deep.equal(result.hpB);
        expect([onchain.rounds, onchain.winner]).to.deep.equal([BigInt(result.rounds), BigInt(result.winner)]);
      }
    });
  });

  describe("battle passives", function () {
    const base = { ...card(Element.Neutral, Element.None, 40), def: 0 };
    const team = (lead = base) => [lead, { ...base }, { ...base }];

    async function check(a, b) {
      const { arena } = await deployArena();
      const front = simulateTeamBattle(a, b);
      const onchain = await arena.simulateTeamBattle(a, b);
      expect(Array.from(onchain.hpA)).to.deep.equal(front.hpA);
      expect(Array.from(onchain.hpB)).to.deep.equal(front.hpB);
      expect([onchain.rounds, onchain.winner]).to.deep.equal([BigInt(front.rounds), BigInt(front.winner)]);
      return front;
    }

    it("floors Pierce's effective DEF before the damage formula and leaves stored stats unchanged", async function () {
      const a = { ...base, element: Element.Fire, atk: 23, passive: Passive.Pierce };
      const b = { ...base, element: Element.Grass, def: 87 };
      const result = await check(team(a), team(b));
      // floor(87 * 0.8) = 69; floor(23 * 1.25 * 100 / 169) = 17.
      // Keeping fractional DEF (69.6) incorrectly gives 16 instead.
      expect(result.log[0].damageA).to.equal(17n);
      expect(battleBreakdown({ ...a, passive: Passive.None }, b).total).to.equal(15);
      expect(a.atk).to.equal(23);
      expect(b.def).to.equal(87);
      const guarded = await check(team(a), team({ ...b, passive: Passive.Guard }));
      expect(guarded.log[0].damageA).to.equal(15n);
    });

    it("checks Underdog at the start of the round, including the exact 50% boundary and lethal retaliation", async function () {
      const a = team({ ...base, passive: Passive.Underdog });
      const b = team({ ...base, maxHP: 1000, atk: 25 });
      const result = await check(a, b);
      expect(result.log.slice(0, 4).map(row => row.damageA)).to.deep.equal([40n, 40n, 48n, 48n]);
      expect(result.log[3].hpA[0]).to.equal(0n);
      const odd = await check(team({ ...a[0], maxHP: 101 }), team({ ...b[0], atk: 50 }));
      // 51/101 is above half; 1/101 is below half.
      expect(odd.log.slice(0, 3).map(row => row.damageA)).to.deep.equal([40n, 40n, 48n]);
    });

    it("evaluates both Underdog triggers before simultaneous lethal attacks", async function () {
      const a = Array.from({ length: 3 }, () => ({ ...base, atk: 50, passive: Passive.Underdog }));
      const result = await check(a, a);
      expect(result.log.map(row => [row.damageA, row.damageB])).to.deep.equal([
        [50n, 50n], [60n, 60n], [50n, 50n], [60n, 60n], [50n, 50n], [60n, 60n],
      ]);
      expect([result.hpA, result.hpB, result.winner]).to.deep.equal([[0n, 0n, 0n], [0n, 0n, 0n], 0]);
    });

    it("counts zero, one or two Resonance teammates by primary element only", async function () {
      const lead = { ...base, maxHP: 1000, atk: 100, element: Element.Fire, passive: Passive.Resonance };
      const different = { ...base, element: Element.Water, secondElement: Element.Fire };
      const enemy = team({ ...base, maxHP: 10000, atk: 1 });
      for (let matches = 0; matches <= 2; matches++) {
        const a = [lead, matches >= 1 ? { ...base, element: Element.Fire } : different,
          matches === 2 ? { ...base, element: Element.Fire } : different];
        const result = await check(a, enemy);
        expect(result.log[0].damageA).to.equal(BigInt(100 + matches * 5));
      }
    });

    it("keeps Resonance from a knocked-out teammate and never counts the attacker itself", async function () {
      const lead = { ...base, maxHP: 10, atk: 0 };
      const next = { ...base, atk: 100, passive: Passive.Resonance };
      const a = [lead, next, { ...base, element: Element.Water }];
      const result = await check(a, team({ ...base, maxHP: 10000, atk: 10 }));
      expect(result.log[0].hpA[0]).to.equal(0n);
      expect(result.log[1].activeA).to.equal(1);
      expect(result.log[1].damageA).to.equal(105n);
    });

    it("applies Focus only once to a survivor even when the opponent changes", async function () {
      const a = team({ ...base, passive: Passive.Focus });
      const b = Array.from({ length: 3 }, () => ({ ...base, maxHP: 50, atk: 1 }));
      const result = await check(a, b);
      expect(result.log.map(row => row.damageA)).to.deep.equal([50n, 40n, 40n, 40n, 40n]);
      expect(result.hpA).to.deep.equal([95n, 100n, 100n]);
      expect(result.hpB).to.deep.equal([0n, 0n, 0n]);
    });

    it("gives each replacement its own Focus attack, even when that attack is lethal to itself", async function () {
      const a = Array.from({ length: 3 }, () => ({ ...base, maxHP: 10, atk: 8, passive: Passive.Focus }));
      const result = await check(a, team({ ...base, atk: 10 }));
      expect(result.log.map(row => [row.activeA, row.damageA])).to.deep.equal([[0, 10n], [1, 10n], [2, 10n]]);
      expect(result.hpA).to.deep.equal([0n, 0n, 0n]);
      expect(result.hpB).to.deep.equal([70n, 100n, 100n]);
    });

    it("rounds attack bonuses before Guard and keeps every final hit at least one", async function () {
      const a = team({ ...base, atk: 14, passive: Passive.Underdog });
      const b = team({ ...base, maxHP: 1000, atk: 50, passive: Passive.Guard });
      const result = await check(a, b);
      // floor(floor(14 * 1.2) * 0.9) = 14, not floor(14 * 1.2 * 0.9) = 15.
      expect(result.log.slice(0, 2).map(row => row.damageA)).to.deep.equal([12n, 14n]);
      for (const passive of Object.values(Passive)) {
        const weak = await check(team({ ...base, atk: 0, passive }), team({ ...base, def: 65535, passive: Passive.Guard }));
        expect(weak.log.every(row => row.damageA === 1n)).to.equal(true);
      }
    });

    it("matches the single-card helper for every passive pairing and uint16 maximum stats", async function () {
      const { arena } = await deployArena();
      for (const passiveA of Object.values(Passive)) {
        for (const passiveB of Object.values(Passive)) {
          const a = { ...base, maxHP: 65535, atk: 65535, def: 65535, passive: passiveA };
          const b = { ...a, element: Element.Fire, secondElement: Element.Ice, passive: passiveB };
          const front = simulateBattle(a, b);
          const onchain = await arena.simulateBattle(a, b);
          expect([onchain.hpA, onchain.hpB, onchain.damageA, onchain.damageB, onchain.rounds, onchain.winner])
            .to.deep.equal([front.hpA, front.hpB, front.damageA, front.damageB, front.rounds, front.winner].map(BigInt));
        }
      }
    });

    it("does not mutate teams or retain Focus state between simulations", async function () {
      const a = team({ ...base, passive: Passive.Focus });
      const b = team({ ...base, passive: Passive.Pierce });
      const before = JSON.stringify([a, b]);
      const first = await check(a, b);
      const second = simulateTeamBattle(a, b);
      expect(second).to.deep.equal(first);
      expect(JSON.stringify([a, b])).to.equal(before);
    });

    it("matches onchain results across 136 ordered teams with all five passives and dual elements", async function () {
      const { arena } = await deployArena();
      for (let i = 0; i < SPECIES.length; i++) {
        const a = [0, 1, 2].map(j => ({ ...base, ...SPECIES[(i + j * 13) % 136], passive: (i + j) % 6 }));
        const b = [0, 1, 2].map(j => ({ ...base, ...SPECIES[(i * 37 + j * 19 + 17) % 136], passive: (i + j * 2 + 3) % 6 }));
        const front = simulateTeamBattle(a, b);
        const onchain = await arena.simulateTeamBattle(a, b);
        expect(Array.from(onchain.hpA)).to.deep.equal(front.hpA);
        expect(Array.from(onchain.hpB)).to.deep.equal(front.hpB);
        expect([onchain.rounds, onchain.winner]).to.deep.equal([BigInt(front.rounds), BigInt(front.winner)]);
      }
    });
  });

  describe("battle flow", function () {
    it("commits the entire team and its order using the same browser hash", async function () {
      const { arena, alice, bob, mint, commit } = await deployArena();
      const ids = await mint(alice, [Species.Foxparks, 20]);
      const secret = commit(alice, ids);
      expect(await arena.computeCommitment(ids, secret.salt, alice.address)).to.equal(frontendCommitment(ids, secret.salt, alice.address));
      expect(await arena.computeCommitment([...ids].reverse(), secret.salt, alice.address)).not.to.equal(secret.commitment);
      expect(await arena.computeCommitment(ids, secret.salt, bob.address)).not.to.equal(secret.commitment);
      await arena.connect(alice).createBattle(secret.commitment, STAKE);
      const rival = commit(bob, await mint(bob, [Species.Lifmunk, 20]));
      await arena.connect(bob).joinBattle(1, rival.commitment);
      await expect(arena.connect(alice).reveal(1, [...ids].reverse(), secret.salt)).to.be.revertedWithCustomError(arena, "CommitmentMismatch");
    });

    it("rejects duplicate team cards without partially revealing the team", async function () {
      const { arena, alice, bob, mint, commit } = await deployArena();
      const ids = await mint(alice, [Species.Lamball, 20]);
      const repeated = [ids[0], ids[1], ids[0]];
      const secret = commit(alice, repeated);
      const rival = commit(bob, await mint(bob, [Species.Lamball, 20]));
      await arena.connect(alice).createBattle(secret.commitment, STAKE);
      await arena.connect(bob).joinBattle(1, rival.commitment);
      await expect(arena.connect(alice).reveal(1, repeated, secret.salt)).to.be.revertedWithCustomError(arena, "DuplicateCard").withArgs(ids[0]);
      expect((await arena.getBattle(1)).creatorRevealed).to.equal(false);
      const [snapshot] = await arena.getRevealedCards(1);
      expect(snapshot.every(card => card.maxHP === 0n)).to.equal(true);
    });

    it("stores and reloads three ordered IDs in the browser secret, and ignores legacy secrets", function () {
      const data = new Map<string, string>();
      const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
        setItem: (key: string, value: string) => data.set(key, value), getItem: (key: string) => data.get(key) ?? null,
      } });
      try {
        expect(saveSecret("test", { tokenIds: [9n, 4n, 7n], salt: "secret" })).to.equal(true);
        expect(loadSecret("test")).to.deep.equal({ tokenIds: ["9", "4", "7"], salt: "secret" });
        data.set("elemental-duel:secret:old", JSON.stringify({ tokenId: "9", salt: "secret" }));
        expect(loadSecret("old")).to.equal(null);
        expect(() => frontendCommitment([1, 1, 2], ethers.ZeroHash, ethers.ZeroAddress)).to.throw("three different cards");
      } finally {
        if (previous) Object.defineProperty(globalThis, "localStorage", previous);
        else Reflect.deleteProperty(globalThis, "localStorage");
      }
    });
    it("createBattle takes the stake and stores the commitment", async function () {
      const { coin, arena, alice, mint, commit, coinChanges } = await deployArena();
      const { commitment } = commit(alice, await mint(alice, [Species.Foxparks, 20]));

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
      const { commitment } = commit(owner, await mint(owner, [Species.Foxparks, 20]));
      await expect(arena.connect(owner).createBattle(commitment, STAKE)).to.be.revertedWithCustomError(
        coin,
        "ERC20InsufficientBalance",
      );

      const aliceSecret = commit(alice, await mint(alice, [Species.Foxparks, 20]));
      await arena.connect(alice).createBattle(aliceSecret.commitment, STAKE);
      await expect(arena.connect(owner).joinBattle(1, commitment)).to.be.revertedWithCustomError(
        coin,
        "ERC20InsufficientBalance",
      );
    });

    it("joinBattle takes the same stake and sets the reveal deadline", async function () {
      const { arena, alice, bob, carol, mint, commit, coinChanges } = await deployArena();
      const aliceSecret = commit(alice, await mint(alice, [Species.Foxparks, 20]));
      const bobSecret = commit(bob, await mint(bob, [Species.Fuack, 20]));
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
      const { commitment } = commit(alice, await mint(alice, [Species.Foxparks, 20]));
      await arena.connect(alice).createBattle(commitment, STAKE);

      await expect(arena.connect(alice).joinBattle(1, commitment)).to.be.revertedWithCustomError(
        arena,
        "CannotJoinOwnBattle",
      );
    });

    it("reveal rejects a salt or card that does not match the commitment", async function () {
      const { arena, alice, carol, mint, startBattle } = await deployArena();
      const { aliceSecret } = await startBattle([Species.Foxparks, 20], [Species.Fuack, 20]);
      const otherCard = await mint(alice, [Species.Lifmunk, 30]);
      const wrongSalt = ethers.hexlify(ethers.randomBytes(32));

      await expect(
        arena.connect(alice).reveal(1, aliceSecret.tokenIds, wrongSalt),
      ).to.be.revertedWithCustomError(arena, "CommitmentMismatch");
      await expect(
        arena.connect(alice).reveal(1, otherCard, aliceSecret.salt),
      ).to.be.revertedWithCustomError(arena, "CommitmentMismatch");
      // Someone else cannot reveal even with the right secret.
      await expect(
        arena.connect(carol).reveal(1, aliceSecret.tokenIds, aliceSecret.salt),
      ).to.be.revertedWithCustomError(arena, "NotPlayer");

      await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);
      await expect(
        arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt),
      ).to.be.revertedWithCustomError(arena, "AlreadyRevealed");
    });

    it("reveal rejects a card the player no longer owns or has decomposed", async function () {
      const { cards, arena, alice, bob, carol, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Foxparks, 20], [Species.Fuack, 20]);

      await cards.connect(alice).transferFrom(alice.address, carol.address, aliceSecret.tokenIds[1]);
      await expect(arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt))
        .to.be.revertedWithCustomError(arena, "NotCardOwner")
        .withArgs(aliceSecret.tokenIds[1]);

      await cards.connect(bob).decompose(bobSecret.tokenIds[2]);
      await expect(arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt)).to.be.revertedWithCustomError(
        cards,
        "ERC721NonexistentToken",
      );
    });

    it("the second reveal pays 2x stake to the simulated winner", async function () {
      const { coin, arena, alice, bob, startBattle, coinChanges } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Foxparks, 30], [Species.Lifmunk, 25]);

      await expect(arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt))
        .to.emit(arena, "TeamRevealed")
        .withArgs(1n, alice.address, aliceSecret.tokenIds);

      const changes = await coinChanges([alice, bob], async () => {
        await expect(arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt))
          .to.emit(arena, "BattleResolved")
          .withArgs(1n, alice.address, STAKE * 2n);
      });
      expect(changes).to.deep.equal([STAKE * 2n, 0n]);
      expect(await coin.balanceOf(await arena.getAddress())).to.equal(0n);

      const battle = await arena.getBattle(1);
      expect(battle.status).to.equal(Status.Resolved);
      expect(battle.winner).to.equal(alice.address);
      expect(battle.creatorTokenIds).to.deep.equal(aliceSecret.tokenIds);
      expect(battle.opponentTokenIds).to.deep.equal(bobSecret.tokenIds);
    });

    it("settles from the simulation: legacy power is ignored and passives can change the winner", async function () {
      async function winnerOf(aliceCard: CardSpec, bobCard: CardSpec) {
        const { arena, alice, bob, startBattle } = await deployArena();
        const { aliceSecret, bobSecret } = await startBattle(aliceCard, bobCard);
        await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);
        await arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt);
        const { winner } = await arena.getBattle(1);
        return winner === alice.address ? "alice" : winner === bob.address ? "bob" : "draw";
      }
      expect(await winnerOf([Species.Foxparks, 1], [Species.Lifmunk, 255])).to.equal("alice");
      expect(await winnerOf([Species.Lamball, 255], [Species.Depresso, 1])).to.equal("bob");
      expect(await winnerOf([Species.Foxparks, 30], [Species.Foxparks, 30])).to.equal("draw");
      expect(await winnerOf([Species.Lifmunk, 1], [Species.Lifmunk, 255])).to.equal("draw");
      expect(await winnerOf([Species.Lifmunk, 1, Passive.Guard], [Species.Lifmunk, 255])).to.equal("alice");
    });

    it("a tie refunds both players", async function () {
      const { arena, alice, bob, startBattle, coinChanges } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Foxparks, 20], [Species.Foxparks, 20]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);

      const changes = await coinChanges([alice, bob], async () => {
        await expect(arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt))
          .to.emit(arena, "BattleResolved")
          .withArgs(1n, ethers.ZeroAddress, STAKE);
      });
      expect(changes).to.deep.equal([STAKE, STAKE]);
      expect((await arena.getBattle(1)).winner).to.equal(ethers.ZeroAddress);
    });

    it("resolves with the card as revealed, even if it is decomposed afterwards", async function () {
      const { cards, arena, alice, bob, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Foxparks, 30], [Species.Lifmunk, 25]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);
      await cards.connect(alice).decompose(aliceSecret.tokenIds[0]);

      await arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt);
      expect((await arena.getBattle(1)).winner).to.equal(alice.address);
    });

    it("keeps reveal snapshots so enchanting after reveal cannot add a battle passive", async function () {
      const { cards, arena, alice, bob, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Foxparks, 30], [Species.Foxparks, 30]);

      // Enchanting after the reveal changes the card but not the battle.
      await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);
      await cards.connect(alice).enchant(aliceSecret.tokenIds[0]);
      await arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt);

      const [[creatorCard]] = await arena.getRevealedCards(1);
      expect(creatorCard.passive).to.equal(BigInt(Passive.None));
      expect((await arena.getBattle(1)).winner).to.equal(ethers.ZeroAddress);
    });

    it("pays for the snapshotted passive even if enchanting replaces it before the second reveal", async function () {
      const { cards, arena, alice, bob, startBattle, coinChanges } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Lifmunk, 1, Passive.Guard], [Species.Lifmunk, 255]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);
      for (const tokenId of aliceSecret.tokenIds) {
        for (let attempt = 0; attempt < 20; attempt++) {
          await cards.connect(alice).enchant(tokenId);
          if ((await cards.getCard(tokenId)).passive !== BigInt(Passive.Guard)) break;
        }
        expect((await cards.getCard(tokenId)).passive).to.not.equal(BigInt(Passive.Guard));
      }
      const changes = await coinChanges([alice, bob], async () => {
        await arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt);
      });
      const [creatorTeam] = await arena.getRevealedCards(1);
      expect(creatorTeam.every(card => card.passive === BigInt(Passive.Guard))).to.equal(true);
      expect((await arena.getBattle(1)).winner).to.equal(alice.address);
      expect(changes).to.deep.equal([STAKE * 2n, 0n]);
    });

    it("claimTimeout gives the pot to the only player who revealed", async function () {
      const { arena, alice, bob, carol, startBattle, coinChanges } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Foxparks, 10], [Species.Foxparks, 39]);
      await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);

      await expect(arena.connect(carol).claimTimeout(1)).to.be.revertedWithCustomError(arena, "RevealWindowOpen");

      await networkHelpers.time.increase(REVEAL_WINDOW + 1);
      await expect(
        arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt),
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
      await startBattle([Species.Foxparks, 20], [Species.Fuack, 20]);
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
      const { commitment } = commit(alice, await mint(alice, [Species.Foxparks, 20]));
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
      const aliceCommitment = commit(alice, await mint(alice, [Species.Foxparks, 20])).commitment;
      const bobCommitment = commit(bob, await mint(bob, [Species.Fuack, 20])).commitment;
      await arena.connect(alice).createBattle(aliceCommitment, 0);
      await arena.connect(bob).createBattle(bobCommitment, 0);
      await arena.connect(alice).joinBattle(2, aliceCommitment);

      expect(await arena.battlesOf(alice.address)).to.deep.equal([1n, 2n]);
      expect(await arena.battlesOf(bob.address)).to.deep.equal([2n]);
      expect(await arena.battlesOf(carol.address)).to.deep.equal([]);
    });

    it("getRevealedCards keeps the revealed cards after they are gone", async function () {
      const { cards, arena, alice, bob, startBattle } = await deployArena();
      const { aliceSecret, bobSecret } = await startBattle([Species.Foxparks, 30], [Species.Lifmunk, 25]);

      // Nothing revealed yet: both sides are zeroed.
      let [[creatorCard], [opponentCard]] = await arena.getRevealedCards(1);
      expect(creatorCard.power).to.equal(0n);
      expect(opponentCard.power).to.equal(0n);

      await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);
      await arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt);
      await cards.connect(alice).decompose(aliceSecret.tokenIds[0]);

      [[creatorCard], [opponentCard]] = await arena.getRevealedCards(1);
      expect([creatorCard.speciesId, creatorCard.power]).to.deep.equal([BigInt(Species.Foxparks), 30n]);
      expect([opponentCard.speciesId, opponentCard.power]).to.deep.equal([BigInt(Species.Lifmunk), 25n]);
      for (const [revealed, speciesId] of [[creatorCard, Species.Foxparks], [opponentCard, Species.Lifmunk]]) {
        const source = SPECIES[speciesId];
        expect([revealed.maxHP, revealed.atk, revealed.def]).to.deep.equal([source.maxHP, source.atk, source.def].map(BigInt));
      }
      await expect(arena.getRevealedCards(2)).to.be.revertedWithCustomError(arena, "BattleNotFound").withArgs(2n);
    });

    it("plays a friendly match with no stake", async function () {
      const { arena, alice, bob, startBattle, coinChanges } = await deployArena();
      // Fire vs Grass is resolved from official stats and the 1.25x element factor.
      const { aliceSecret, bobSecret } = await startBattle([Species.Foxparks, 25], [Species.Lifmunk, 10], 0n);
      await arena.connect(alice).reveal(1, aliceSecret.tokenIds, aliceSecret.salt);

      const changes = await coinChanges([alice, bob], async () => {
        await expect(arena.connect(bob).reveal(1, bobSecret.tokenIds, bobSecret.salt))
          .to.emit(arena, "BattleResolved")
          .withArgs(1n, alice.address, 0n);
      });
      expect(changes).to.deep.equal([0n, 0n]);
    });
  });
});
