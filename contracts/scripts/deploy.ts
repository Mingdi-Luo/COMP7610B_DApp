import hre, { network } from "hardhat";
import { exportAbis, saveDeployment } from "./frontend-sync.js";

// Usage: npm run deploy:local   (with `npm run node` running in another terminal)
const { ethers } = await network.create();

const [deployer] = await ethers.getSigners();
const { chainId } = await ethers.provider.getNetwork();
console.log(`Deploying to chain ${chainId} from ${deployer.address}`);

const coin = await ethers.deployContract("GameCoin");
await coin.waitForDeployment();
const coinAddress = await coin.getAddress();
console.log(`GameCoin:     ${coinAddress}`);

const cards = await ethers.deployContract("ElementCards", [coinAddress]);
await cards.waitForDeployment();
const cardsAddress = await cards.getAddress();
console.log(`ElementCards: ${cardsAddress}`);

// Arena needs the card contract's address so it can read card attributes.
const arena = await ethers.deployContract("Arena", [cardsAddress]);
await arena.waitForDeployment();
const arenaAddress = await arena.getAddress();
console.log(`Arena:        ${arenaAddress}`);

// Let both game contracts move coins, so players never send an ERC-20 approval.
await (await coin.setGameContract(cardsAddress, true)).wait();
await (await coin.setGameContract(arenaAddress, true)).wait();

await saveDeployment(chainId, { GameCoin: coinAddress, ElementCards: cardsAddress, Arena: arenaAddress });
await exportAbis(hre);
