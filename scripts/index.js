import { isWorldTable, isCompendiumTable, rollTable } from "./table-utils.js";

// API interface for the module
class AllGoblinsHaveNames {
    /**
     * rerolls the name and bio of all selected tokens
     */
    async rerollSelectedTokens() {
        for (let token of canvas.tokens.controlled) {
            const result = await getNewRolledValues(token.actor.data.token);
            saveRolledValues(token.document, result);
        }
    }

    /**
     * takes a string referencing a table  and rolls
     * @param {string} tableStr (like @Compendium[id]{name})
     */
    rollFromTableString(tableStr) {
        // not a valid table string, just return the input
        if (!isWorldTable(tableStr) && !isCompendiumTable(tableStr)) {
            return tableStr;
        }
        return isWorldTable(tableStr)
            ? getRollTableResult(tableStr)
            : getCompendiumTableResult(tableStr);
    }
}

/**
 * Gets the result from a roll table. Synchronous.
 * @param {string} displayName
 * @resturn {Array.<object>} the result of the roll
 */
async function getRollTableResult(displayName) {
    // @UUID[RollTable.OfTzIzGy7fyCgGz7]{Elf First Name}  
    // get the table by its ID
    const endIndex = displayName.indexOf("]");
    const table_id = displayName.substring(16, endIndex);
    const table = game.tables.contents.find((t) => t._id == table_id);

    if (table) {
        return await rollTable(table);
    } else {
        ui.notifications.error("Can't find a table that matches " + displayName);
    }
}

/**
 * Gets the results from a compendium table. Asynchronous.
 * @param {string} displayName
 * @returns {Promise}
 */
async function getCompendiumTableResult(displayName) {
    // get the identifier
    const endIndex = displayName.indexOf("]");
    const idParts = displayName.substring(6, endIndex).split(".");

    // @UUID[Compendium.monks-enhanced-journal.person-names.RollTable.AQBywLCajYDmBTay]{Dwarf Last Name}

    // sanity check that it matches the expected format
    if (idParts.length !== 5) {
        throw new Error(
            `Expected format to match @UUID[Compendium.module.table.Rolltable.id] Got: ${displayName}`
        );
    }

    // get pack
    const packId = `${idParts[1]}.${idParts[2]}`;
    const pack = game.packs.get(packId);
    if (!pack) {
        throw new Error(`Couldn't find a compendium with id ${packId}`);
    }

    // get table
    const table = await pack.getDocument(idParts[4]);

    if (!table) {
        throw new Error(
            `Couldn't find table with id ${idParts[4]} in pack ${packId}`
        );
    }

    // check if is better table
    const results = await rollTable(table);
    if (!results || !results.length) {
        throw new Error(`Couldn't roll table id ${idParts[4]} in pack ${packId}`);
    }
    return results;
}

/**
 * Searches for tables in the name field and biogrpahy
 * @param {TokenData} tokenData
 */
function mineForTableStrings(tokenData) {
    const displayName = tokenData.name.trim();
    let nameTableStr, bioDataPath, bioTableStr;
    if (isWorldTable(displayName) || isCompendiumTable(displayName)) {
        nameTableStr = displayName;
    }

    // Mine biography for tables
    const actorId = tokenData.actorId || tokenData.document.id;
    if (!tokenData.actorLink && actorId) {
        let actor = game.actors.get(actorId);
        let actorData = actor.system;

        let bio;
        // structure of simple worldbuilding system
        if (actorData.biography) {
            bio = actorData.biography;
            bioDataPath = "data.biography";
        }
        // structure of D&D 5e NPCs and PCs
        else if (
            actorData.details &&
            actorData.details.biography &&
            actorData.details.biography.value
        ) {
            bio = actorData.details.biography.value;
            bioDataPath = "system.details.biography.value";
        }

        // get text out of bio
        let el = document.createElement("div");
        el.innerHTML = bio;
        let bioText = el.innerText.trim();
        if (isWorldTable(bioText) || isCompendiumTable(bioText)) {
            bioTableStr = bioText;
        }
    }
    return { nameTableStr, bioDataPath, bioTableStr };
}

/**
 * Rolls for new values
 * @param {TokenData} tokenData
 * @returns {Promise} resolves to an object with name and bio.
 */
async function getNewRolledValues({ nameTableStr, bioTableStr, bioDataPath }) {
    try {
        let result = { bioDataPath };
        // name
        if (nameTableStr) {
            result.name = await game.allGoblinsHaveNames.rollFromTableString(
                nameTableStr
            );
        }

        // bio
        if (bioTableStr) {
            result.bio = await game.allGoblinsHaveNames.rollFromTableString(
                bioTableStr
            );
        }

        return result;
    } catch (e) {
        console.warn("[All Goblins Have Names]: " + e.message);
    }
}

/**
 * Saves the result from getNewRolledValues to the token
 * @param {TokenDocument} tokenDocument
 * @param {object} result
 */
function saveRolledValues(tokenDocument, result) {
    // do the update
    tokenDocument.update({
        name: result.name,
    });
    if (result.bio) tokenDocument.actor.update({ [result.bioDataPath]: result.bio });
	if (game.settings.get("all-goblins-have-names-reborn", "syncActorName") && result.name)
		tokenDocument.actor.update({
			name: result.name
		});
}

/**
 * ------------------------------------------------------------------------------
 * Initialize the All Goblins Have Names module
 */

Hooks.once("init", () => {
    // add the API
    game.allGoblinsHaveNames = new AllGoblinsHaveNames();
	game.settings.register("all-goblins-have-names-reborn", "syncActorName", {
		name: "Sync actor name.",
		hint: "When enabled automatically synchronize actor name with their token name.",
		default: false,
		scope: "world",
		type: Boolean,
		config: true
	});
});

Hooks.on("ready", () => {
    /**
     * @param {TokenDocument} tokenDocument
     */
    Hooks.on("createToken", async (tokenDocument) => {
        const toRoll = mineForTableStrings(tokenDocument);

        // bail if there is no table strings to roll on
        if (!toRoll.nameTableStr && !toRoll.bioTableStr) {
            return;
        }

        // clear token name so we don't display software gore to the user while async is running
        tokenDocument.name = " ";

        // do the roll
        const result = await getNewRolledValues(toRoll);

        saveRolledValues(tokenDocument, result);
    });
});
