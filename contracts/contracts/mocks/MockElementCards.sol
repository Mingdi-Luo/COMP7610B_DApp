// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ElementCards} from "../ElementCards.sol";

/**
 * @title MockElementCards
 * @notice Test-only ElementCards that lets anyone mint a card with chosen
 *         attributes, so battle tests can set up exact matchups.
 *         Never deploy this to a public network.
 */
contract MockElementCards is ElementCards {
    function mintCard(address to, Element element, Rarity rarity, uint8 power) external returns (uint256) {
        return _issueCard(to, Card(element, rarity, power));
    }
}
