import { Interface } from "ethers";
import elementCardsAbi from "../config/abi/ElementCards.json";
import arenaAbi from "../config/abi/Arena.json";

// ethers decodes custom errors only for read calls. A transaction that fails
// gas estimation arrives as "unknown custom error", so decode it here.
const INTERFACES = [new Interface(elementCardsAbi), new Interface(arenaAbi)];

// Friendly text for the custom errors declared in ElementCards.sol and Arena.sol.
const CONTRACT_ERRORS = {
  NotImplemented: "This feature is not implemented in the contract yet.",
  WrongPayment: "Send exactly the pack price.",
  NotCardOwner: "You do not own that card.",
  DuplicateCard: "Pick three different cards.",
  RarityMismatch: "All three cards must have the same rarity.",
  CannotMergeLegendary: "Legendary cards cannot be merged.",
  BattleNotFound: "That battle does not exist.",
  InvalidStatus: "This battle is not in the right state for that action.",
  StakeMismatch: "Send exactly the same stake as the battle creator.",
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

/** The matching custom error ({ name, args }) from either contract, or null. */
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
