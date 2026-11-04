import { Interface } from "ethers";
import gameCoinAbi from "../config/abi/GameCoin.json";
import elementCardsAbi from "../config/abi/ElementCards.json";
import arenaAbi from "../config/abi/Arena.json";

// ethers decodes custom errors only for read calls. A transaction that fails
// gas estimation arrives as "unknown custom error", so decode it here.
const INTERFACES = [new Interface(gameCoinAbi), new Interface(elementCardsAbi), new Interface(arenaAbi)];

// Friendly text for the custom errors declared in the contracts.
const CONTRACT_ERRORS = {
  ERC20InsufficientBalance: "You do not have enough coins. Top up first.",
  InvalidTopUp: "Top up a whole number of coins.",
  NotGameContract: "The game contracts are not authorized to move coins. Check the deployment.",
  ERC721NonexistentToken: "That card no longer exists. It may have been merged or decomposed.",
  NotCardOwner: "You do not own that card.",
  DuplicateCard: "Pick different cards.",
  RarityMismatch: "All three cards must have the same rarity.",
  CannotMergeLegendary: "Legendary cards cannot be merged.",
  UnknownSpecies: "That species does not exist.",
  BreedOnCooldown: "That card is still resting from its last breeding.",
  SameGender: "Breeding needs one male and one female.",
  BattleNotFound: "That battle does not exist.",
  InvalidStatus: "This battle is not in the right state for that action.",
  CannotJoinOwnBattle: "You cannot join your own battle.",
  NotPlayer: "You are not a player in this battle.",
  NotCreator: "Only the battle creator can do this.",
  AlreadyRevealed: "You have already revealed your card.",
  CommitmentMismatch: "That card and salt do not match your commitment.",
  RevealWindowClosed: "The reveal window has closed.",
  RevealWindowOpen: "The reveal window is still open.",
};

export function readableError(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return "The MetaMask request was rejected. You can try again when ready.";
  }
  if (error?.code === "INSUFFICIENT_FUNDS") {
    return "This account does not have enough ETH for the transaction and its gas.";
  }

  const revert = decodeRevert(error);
  if (revert && CONTRACT_ERRORS[revert.name]) return CONTRACT_ERRORS[revert.name];
  if (revert) return `The contract rejected the transaction (${revert.name}).`;
  // A require(..., "message") reason string.
  if (error?.reason) return error.reason;

  return (
    error?.info?.error?.message ||
    error?.shortMessage ||
    error?.message ||
    "Something went wrong"
  );
}

/** The matching custom error ({ name, args }) from any game contract, or null. */
function decodeRevert(error) {
  if (error?.revert?.name) return error.revert;

  // Wallets put the revert data in different places.
  const data = [error?.data, error?.info?.error?.data, error?.info?.error?.data?.data, error?.error?.data].find(
    (value) => typeof value === "string" && value.startsWith("0x") && value.length >= 10,
  );
  if (!data) return null;

  for (const contractInterface of INTERFACES) {
    const parsed = contractInterface.parseError(data);
    if (parsed) return parsed;
  }
  return null;
}
