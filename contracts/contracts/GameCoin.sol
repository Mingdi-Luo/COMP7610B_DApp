// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GameCoin
 * @notice The in-game currency of Elemental Duel. Players top up with ETH at a
 *         fixed rate and spend coins on packs, enchants, breeding and stakes.
 *
 * Top-ups are one-way. Decomposing cards mints new coins, so the supply is not
 * fully backed by ETH and coins cannot be redeemed.
 *
 * Game contracts approved by the owner can move a player's coins without an
 * ERC-20 approval, so each game action needs only one MetaMask confirmation.
 */
contract GameCoin is ERC20, Ownable {
    uint256 public constant COINS_PER_ETH = 1_000_000;
    uint256 public constant WEI_PER_COIN = 1 ether / COINS_PER_ETH;

    mapping(address game => bool) public isGameContract;

    event ToppedUp(address indexed player, uint256 weiPaid, uint256 coins);
    event GameContractSet(address indexed game, bool allowed);

    error InvalidTopUp(uint256 sent);
    error NotGameContract(address caller);
    error WithdrawFailed();

    modifier onlyGame() {
        if (!isGameContract[msg.sender]) revert NotGameContract(msg.sender);
        _;
    }

    constructor() ERC20("Duel Coin", "DUEL") Ownable(msg.sender) {}

    /// @notice Coins are whole units.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /**
     * @notice Buy coins with ETH. The amount must be a whole number of coins.
     * @return coins The number of coins minted to the caller.
     */
    function topUp() external payable returns (uint256 coins) {
        if (msg.value == 0 || msg.value % WEI_PER_COIN != 0) revert InvalidTopUp(msg.value);
        coins = msg.value / WEI_PER_COIN;
        _mint(msg.sender, coins);
        emit ToppedUp(msg.sender, msg.value, coins);
    }

    /// @notice Allow or block a game contract. Called once per contract after deployment.
    function setGameContract(address game, bool allowed) external onlyOwner {
        isGameContract[game] = allowed;
        emit GameContractSet(game, allowed);
    }

    /// @notice Burn a player's coins as payment for a game action.
    function spend(address from, uint256 amount) external onlyGame {
        _burn(from, amount);
    }

    /// @notice Mint coins to a player as a game reward.
    function reward(address to, uint256 amount) external onlyGame {
        _mint(to, amount);
    }

    /// @notice Move a player's coins, for example into the Arena as a stake.
    function collect(address from, address to, uint256 amount) external onlyGame {
        _transfer(from, to, amount);
    }

    /// @notice Send all ETH from top-ups to the owner.
    function withdraw() external onlyOwner {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        if (!ok) revert WithdrawFailed();
    }
}
