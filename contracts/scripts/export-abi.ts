import hre from "hardhat";
import { exportAbis } from "./frontend-sync.js";

// Usage: npm run export-abi   (after changing a contract's functions or events)
await exportAbis(hre);
