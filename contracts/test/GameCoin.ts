import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

async function deployCoin() {
  const [owner, alice, bob] = await ethers.getSigners();
  const coin = await ethers.deployContract("GameCoin");
  return { coin, owner, alice, bob };
}

describe("GameCoin", function () {
  it("is a whole-unit ERC-20 with a fixed top-up rate", async function () {
    const { coin } = await deployCoin();
    expect(await coin.name()).to.equal("Duel Coin");
    expect(await coin.symbol()).to.equal("DUEL");
    expect(await coin.decimals()).to.equal(0n);
    expect(await coin.COINS_PER_ETH()).to.equal(1_000_000n);
  });

  it("mints coins for ETH at the fixed rate and emits ToppedUp", async function () {
    const { coin, alice } = await deployCoin();
    const value = ethers.parseEther("0.001");

    await expect(coin.connect(alice).topUp({ value }))
      .to.emit(coin, "ToppedUp")
      .withArgs(alice.address, value, 1_000n);

    expect(await coin.balanceOf(alice.address)).to.equal(1_000n);
    expect(await ethers.provider.getBalance(coin)).to.equal(value);
  });

  it("rejects a top-up of zero or a fraction of a coin", async function () {
    const { coin, alice } = await deployCoin();
    await expect(coin.connect(alice).topUp()).to.be.revertedWithCustomError(coin, "InvalidTopUp").withArgs(0n);
    await expect(coin.connect(alice).topUp({ value: 1n }))
      .to.be.revertedWithCustomError(coin, "InvalidTopUp")
      .withArgs(1n);
  });

  it("only lets approved game contracts spend, reward and collect", async function () {
    const { coin, alice, bob } = await deployCoin();
    await coin.connect(alice).topUp({ value: ethers.parseEther("0.001") });

    for (const call of [
      coin.connect(bob).spend(alice.address, 1),
      coin.connect(bob).reward(bob.address, 1),
      coin.connect(bob).collect(alice.address, bob.address, 1),
    ]) {
      await expect(call).to.be.revertedWithCustomError(coin, "NotGameContract").withArgs(bob.address);
    }
  });

  it("moves coins for an approved game contract without an ERC-20 approval", async function () {
    const { coin, owner, alice, bob } = await deployCoin();
    await coin.connect(alice).topUp({ value: ethers.parseEther("0.001") });
    await expect(coin.setGameContract(bob.address, true))
      .to.emit(coin, "GameContractSet")
      .withArgs(bob.address, true);

    await coin.connect(bob).spend(alice.address, 100);
    await coin.connect(bob).collect(alice.address, owner.address, 100);
    await coin.connect(bob).reward(alice.address, 50);

    expect(await coin.balanceOf(alice.address)).to.equal(850n);
    expect(await coin.balanceOf(owner.address)).to.equal(100n);
  });

  it("reserves setGameContract and withdraw for the owner", async function () {
    const { coin, alice } = await deployCoin();
    await expect(coin.connect(alice).setGameContract(alice.address, true)).to.be.revertedWithCustomError(
      coin,
      "OwnableUnauthorizedAccount",
    );
    await expect(coin.connect(alice).withdraw()).to.be.revertedWithCustomError(coin, "OwnableUnauthorizedAccount");
  });

  it("keeps top-up ETH in the contract until the owner withdraws", async function () {
    const { coin, owner, alice } = await deployCoin();
    const value = ethers.parseEther("0.5");
    await coin.connect(alice).topUp({ value });

    await expect(coin.withdraw()).to.changeEtherBalances(ethers, [coin, owner], [-value, value]);
  });
});
