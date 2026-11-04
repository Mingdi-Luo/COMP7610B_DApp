import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";

// Files the frontend imports. Keeping them in git lets every teammate run the
// frontend without compiling or deploying the contracts first.
const FRONTEND_CONFIG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/src/config",
);
const DEPLOYMENTS_FILE = path.join(FRONTEND_CONFIG_DIR, "deployments.json");

export const CONTRACT_NAMES = ["GameCoin", "ElementCards", "Arena"] as const;
type ContractName = (typeof CONTRACT_NAMES)[number];

/** Copy each contract's ABI into frontend/src/config/abi/. */
export async function exportAbis(hre: HardhatRuntimeEnvironment) {
  const abiDir = path.join(FRONTEND_CONFIG_DIR, "abi");
  await mkdir(abiDir, { recursive: true });

  for (const name of CONTRACT_NAMES) {
    const artifact = await hre.artifacts.readArtifact(name);
    await writeFile(path.join(abiDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
  }
  console.log(`ABIs written to ${abiDir}`);
}

/** Record deployed addresses for one chain in frontend/src/config/deployments.json. */
export async function saveDeployment(chainId: bigint, addresses: Record<ContractName, string>) {
  let deployments: Record<string, Record<string, string>> = {};
  try {
    deployments = JSON.parse(await readFile(DEPLOYMENTS_FILE, "utf8"));
  } catch {
    // First deployment: start from an empty file.
  }

  deployments[chainId.toString()] = addresses;
  await writeFile(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2) + "\n");
  console.log(`Addresses for chain ${chainId} written to ${DEPLOYMENTS_FILE}`);
}
