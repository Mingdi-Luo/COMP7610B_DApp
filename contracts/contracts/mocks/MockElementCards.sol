// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ElementCards} from "../ElementCards.sol";

/**
 * @title MockElementCards
 * @notice Test-only ElementCards that lets anyone mint a card with chosen
 *         attributes, so tests can set up exact matchups.
 *         Never deploy this to a public network.
 */
contract MockElementCards is ElementCards {
    constructor(address coinAddress) ElementCards(coinAddress) {}

    /// @param speciesId Supplies the card's elements and rarity.
    function mintCard(
        address to,
        uint8 speciesId,
        uint8 power,
        Passive passive,
        Gender gender
    ) external returns (uint256) {
        Species memory species = this.getSpecies(speciesId);
        return
            _issueCard(
                to,
                Card(speciesId, species.element, species.secondElement, species.rarity, power, passive, gender, 0, 0,
                    species.maxHP, species.atk, species.def)
            );
    }
}
