import { validateCustomCard } from "./CustomCards.js";
import { Card, CardID } from "./CardTypes.js";
import { CardsByName, CardVersionsByName, getCard } from "./Cards.js";
import { CCLSettings, CustomCardList, PackLayout } from "./CustomCardList.js";
import { escapeHTML } from "./utils.js";
import { ackError, isSocketError, SocketError } from "./Message.js";
import { isAny, isArrayOfStrings, isBoolean, isNumber, isRecord, isString } from "./TypeChecks.js";

const lineRegex = /^(?:(\d+)\s+)?([^(\v\n]+)??(?:\s\((\w+)\)(?:\s+([^+\s]+))?)?(?:\s+\+?(F))?$/;

// Possible options:
//  - fallbackToCardName: Allow fallback to only a matching card name if exact set and/or collector number cannot be found.
//  - customCards: Dictionary of additional custom cards to try to match first.
export function parseLine(
	line: string,
	options: {
		fallbackToCardName?: boolean;
		customCards?: {
			[cardID: string]: Card;
		} | null;
	} = { fallbackToCardName: false, customCards: null }
): SocketError | { count: number; cardID: CardID; foil: boolean } {
	const trimedLine = line.trim();
	const match = trimedLine.match(lineRegex);
	if (!match)
		return ackError({
			title: `Syntax Error`,
			text: `The line '${trimedLine}' doesn't match the card syntax.`,
			footer: `Full line: '${trimedLine}'`,
		});

	const [, countStr, name, , number, foilStr] = match;
	let [, , , set, ,] = match;
	const foil: boolean = !!foilStr;
	let count = parseInt(countStr);
	if (!Number.isInteger(count)) count = 1;

	// Override with custom cards if available
	if (options?.customCards) {
		// FIXME: This assumes cardID and name are the same.
		if (name in options.customCards) return { count, cardID: name, foil };
	}

	if (set) {
		set = set.toLowerCase();
		if (set === "dar") set = "dom";
		if (set === "conf") set = "con";
	}
	// Note: The regex currently cannot catch this case. Without
	// parenthesis, the collector number will be part of the name.
	if (number && !set) {
		console.log(
			`Collector number without Set`,
			`You should not specify a collector number without also specifying a set: '${trimedLine}'.`
		);
	}

	// Only the name is supplied, get the preferred version of the card
	if (!set && !number && name in CardsByName) return { count, cardID: CardsByName[name], foil };

	// Search for the correct set and collector number
	let candidates: CardID[] = [];

	if (name in CardVersionsByName) {
		candidates = CardVersionsByName[name];
	} else if (name.split(" //")[0] in CardVersionsByName) {
		// If not found, try double faced cards before giving up!
		candidates = CardVersionsByName[name.split(" //")[0]];
	}

	const cardIDs = candidates.filter(
		(cid) => (!set || getCard(cid).set === set) && (!number || getCard(cid).collector_number === number)
	);

	if (cardIDs.length > 0) {
		return {
			count,
			cardID: cardIDs.reduce((best, cid) => {
				if (parseInt(getCard(cid).collector_number) < parseInt(getCard(best).collector_number)) return cid;
				return best;
			}, cardIDs[0]),
			foil: !!foil,
		};
	} else if (options?.fallbackToCardName && name in CardsByName) return { count, cardID: CardsByName[name], foil };

	const message =
		(name in CardsByName
			? `Could not find this exact version of '${name}' (${set}) in our database, but other printings are available.`
			: `Could not find '${name}' in our database.`) +
		` If you think it should be there, please contact us via email or our Discord server.`;

	return ackError({
		title: `Card not found`,
		text: message,
		footer: `Full line: '${trimedLine}'`,
	});
}

function findNthLine(str: string, n: number): number {
	let index = 0;
	for (let i = 0; i < n - 1; i++) {
		index = str.indexOf("\n", index + 1);
		if (index === -1) return -1;
	}
	return index + 1;
}

// Find 'closing' (e.g. ')', ']', '}'...) character in str matching the 'opening' character (e.g. '(', '[', '{'...) found at str[start] and returns its index.
// Returns -1 if not found or if the string doesn't start with the opening character.
function findMatching(str: string, opening: string, closing: string, start: number = 0): number {
	let index = start;
	if (str[index] !== opening) return -1;
	let opened = 1;
	while (index < str.length && opened > 0) {
		++index;
		if (str[index] === opening) ++opened;
		else if (str[index] === closing) --opened;
	}
	if (opened !== 0) return -1;
	return index;
}

function jsonParsingErrorMessage(e: any, jsonStr: string): string {
	let msg = `Error parsing json: ${e.message}.`;
	let position = e.message.match(/at position (\d+)/);
	if (position) {
		position = parseInt(position[1]);
		msg += `<pre>${escapeHTML(
			jsonStr.slice(Math.max(0, position - 50), Math.max(0, position - 1))
		)}<span style="color: red; text-decoration: underline red;">${escapeHTML(jsonStr[position])}</span>${escapeHTML(
			jsonStr.slice(Math.min(position + 1, jsonStr.length), Math.min(position + 50, jsonStr.length))
		)}</pre>`;
	}
	return msg;
}

function parseSettings(
	lines: string[],
	startIdx: number,
	txtcardlist: string,
	customCardList: CustomCardList
): SocketError | { advance: number; settings: CCLSettings } {
	let lineIdx = startIdx;
	if (lines.length <= lineIdx)
		return ackError({
			title: `[Settings]`,
			text: `Expected a settings object, got end-of-file.`,
		});
	if (lines[lineIdx][0] !== "{") {
		return ackError({
			title: `[Settings]`,
			text: `Settings section must be a JSON Object. Line ${lineIdx + 1}: Expected '{', got '${
				lines[lineIdx + 1]
			}'.`,
		});
	}

	let index = findNthLine(txtcardlist, lineIdx);
	while (txtcardlist[index] !== "{") ++index;
	const start = index;
	const end = findMatching(txtcardlist, "{", "}", start);
	if (end === -1)
		return ackError({
			title: `[Settings]`,
			text: `Expected '}', got end-of-file.`,
		});
	let parsedSettings = {};
	const settingsStr = txtcardlist.substring(start, end + 1);
	try {
		parsedSettings = JSON.parse(settingsStr);
	} catch (e: any) {
		return ackError({
			title: `[Settings]`,
			html: jsonParsingErrorMessage(e, settingsStr),
		});
	}
	const settings: CCLSettings = {};

	if ("layouts" in parsedSettings) {
		const layouts: Record<string, PackLayout> = {};

		if (!isRecord(isString, isAny)(parsedSettings.layouts)) {
			return ackError({
				title: `[Settings]`,
				text: `'layouts' must be an object.`,
			});
		}
		for (const [key, value] of Object.entries(parsedSettings.layouts)) {
			if (!("weight" in value)) {
				return ackError({
					title: `[Settings]`,
					text: `Layout '${key}'  must have a 'weight' property.`,
				});
			}
			if (!("slots" in value)) {
				return ackError({
					title: `[Settings]`,
					text: `Layout '${key}' must have a 'slots' property.`,
				});
			}
			if (!isRecord(isString, isNumber)(value["slots"])) {
				return ackError({
					title: `[Settings]`,
					text: `'slots' must be a Record<string, number>.`,
				});
			}
			layouts[key] = {
				weight: value.weight,
				slots: value.slots,
			};
		}

		customCardList.layouts = layouts;
	}

	if ("withReplacement" in parsedSettings) {
		if (!isBoolean(parsedSettings.withReplacement)) {
			return ackError({
				title: `[Settings]`,
				text: `'withReplacement' must be a boolean.`,
			});
		}
		settings.withReplacement = parsedSettings.withReplacement;
	}

	if ("predeterminedLayouts" in parsedSettings) {
		if (!isArrayOfStrings(parsedSettings.predeterminedLayouts)) {
			return ackError({
				title: `[Settings]`,
				text: `'predeterminedLayouts' must be an array of strings.`,
			});
		}
		settings.predeterminedLayouts = parsedSettings.predeterminedLayouts;
	}

	if ("layoutWithReplacement" in parsedSettings) {
		if (!isBoolean(parsedSettings.layoutWithReplacement)) {
			return ackError({
				title: `[Settings]`,
				text: `'layoutWithReplacement' must be a boolean.`,
			});
		}
		settings.layoutWithReplacement = parsedSettings.layoutWithReplacement;
	}

	if (settings.predeterminedLayouts) {
		if (!customCardList.layouts) {
			return ackError({
				title: `[Settings]`,
				text: `Layouts must be declared before setting 'predeterminedLayouts'.`,
			});
		}
		for (const name of settings.predeterminedLayouts) {
			if (!(name in customCardList.layouts)) {
				return ackError({
					title: `[Settings]`,
					text: `Layout '${name}' in 'predeterminedLayouts' has not been declared.`,
				});
			}
		}
	}

	return {
		advance: (settingsStr.match(/\r?\n/g)?.length ?? 0) + 1, // Skip this section's lines
		settings: settings,
	};
}

function parseCustomCards(lines: string[], startIdx: number, txtcardlist: string) {
	let lineIdx = startIdx;
	if (lines.length <= lineIdx)
		return ackError({
			title: `[CustomCards]`,
			text: `Expected a list of custom cards, got end-of-file.`,
		});
	// Custom cards must be a JSON array
	if (lines[lineIdx][0] !== "[") {
		return ackError({
			title: `[CustomCards]`,
			text: `Custom cards section must be a JSON Array. Line ${lineIdx + 1}: Expected '[', got '${
				lines[lineIdx + 1]
			}'.`,
		});
	}
	// Search for the section (matching closing bracket)
	let index = findNthLine(txtcardlist, lineIdx);
	while (txtcardlist[index] !== "[") ++index;
	const start = index;
	const end = findMatching(txtcardlist, "[", "]", start);
	if (end === -1)
		return ackError({
			title: `[CustomCards]`,
			text: `Expected ']', got end-of-file.`,
		});
	let parsedCustomCards = [];
	const customCardsStr = txtcardlist.substring(start, end + 1);
	try {
		parsedCustomCards = JSON.parse(customCardsStr);
	} catch (e: any) {
		return ackError({
			title: `[CustomCards]`,
			html: jsonParsingErrorMessage(e, customCardsStr),
		});
	}

	const customCards: Card[] = [];
	for (const c of parsedCustomCards) {
		const cardOrError = validateCustomCard(c);
		if (isSocketError(cardOrError)) return cardOrError;
		customCards.push(cardOrError);
	}
	return {
		advance: (customCardsStr.match(/\r?\n/g)?.length ?? 0) + 1, // Skip this section's lines
		customCards: customCards,
	};
}

function parsePackLayoutsDeprecated(
	lines: string[],
	startIdx: number
): { advance: number; layouts: Record<string, PackLayout> } | SocketError {
	const layouts: Record<string, PackLayout> = {};
	let lineIdx = startIdx;
	while (lineIdx < lines.length && lines[lineIdx][0] !== "[") {
		const match = lines[lineIdx].match(/-\s*([a-zA-Z]+)\s*\((\d+)\)/);
		if (!match) {
			return ackError({
				title: `Parsing Error`,
				text: `Expected layout declaration (' - LayoutName (Weight)'), got '${lines[lineIdx]}' (line ${
					lineIdx + 1
				}).`,
			});
		}
		const layoutName = match[1];
		const layoutWeight = parseInt(match[2]);
		layouts[layoutName] = { weight: layoutWeight, slots: {} };
		++lineIdx;
		while (lineIdx < lines.length && lines[lineIdx][0] !== "-" && lines[lineIdx][0] !== "[") {
			const slotMatch = lines[lineIdx].match(/(\d+)\s+([a-zA-Z]+)/);
			if (!slotMatch) {
				return ackError({
					title: `Parsing Error`,
					text: `Expected slot specification (' CardCount SlotName'), got '${lines[lineIdx]}' (line ${
						lineIdx + 1
					}).`,
				});
			}
			layouts[layoutName].slots[slotMatch[2]] = parseInt(slotMatch[1]);
			++lineIdx;
		}
	}
	return { advance: lineIdx - startIdx, layouts };
}

// options:
//   - name: string, specify name of returned card list.
//   - fallbackToCardName: boolean
//   - ignoreUnknownCards: boolean, If true, don't error on unknown cards, report the unknown card by mutating the 'outIgnoredCards' parameter and continue.
export function parseCardList(
	txtcardlist: string,
	options: { name?: string; fallbackToCardName?: boolean; ignoreUnknownCards?: boolean },
	outIgnoredCards?: string[]
): CustomCardList | SocketError {
	try {
		// FIXME: Doesn't handle MacOS line endings (\r). Note that we can't remove empty lines at this stage as other functions rely on the line index matching the original text.
		const lines = txtcardlist.split(/\r?\n/).map((s) => s.trim());
		const cardList: CustomCardList = {
			customCards: null,
			layouts: false,
			slots: {},
		};
		let lineIdx = 0;
		while (lines[lineIdx] === "") ++lineIdx; // Skip heading empty lines
		// List has to start with a header if it has custom slots
		if (lines[lineIdx][0] === "[") {
			while (lineIdx < lines.length) {
				if (!lines[lineIdx].startsWith("[") || !lines[lineIdx].endsWith("]")) {
					return ackError({
						title: `Parsing Error`,
						text: `Expected header (for section or slot), got '${lines[lineIdx]}' (line ${lineIdx + 1}).`,
					});
				}
				const header = lines[lineIdx].substring(1, lines[lineIdx].length - 1).trim();
				const lowerCaseHeader = header.toLowerCase();
				++lineIdx;
				if (lowerCaseHeader === "settings") {
					const settingsOrError = parseSettings(lines, lineIdx, txtcardlist, cardList);
					if (isSocketError(settingsOrError)) return settingsOrError;
					cardList.settings = settingsOrError.settings;
					lineIdx += settingsOrError.advance;
				} else if (lowerCaseHeader === "customcards") {
					const cardsOrError = parseCustomCards(lines, lineIdx, txtcardlist);
					if (isSocketError(cardsOrError)) return cardsOrError;
					if (!cardList.customCards) cardList.customCards = {};
					for (const customCard of cardsOrError.customCards) {
						if (customCard.name in cardList.customCards)
							return ackError({
								title: `[CustomCards]`,
								text: `Duplicate card '${customCard.name}'.`,
							});
						cardList.customCards[customCard.name] = customCard;
					}
					lineIdx += cardsOrError.advance;
				} else if (lowerCaseHeader === "layouts") {
					if (cardList.layouts) {
						return ackError({
							title: `Parsing Error`,
							text: `Layouts already defined, redefined on line ${lineIdx}.`,
						});
					}
					const layoutsOrError = parsePackLayoutsDeprecated(lines, lineIdx);
					if (isSocketError(layoutsOrError)) return layoutsOrError;
					lineIdx += layoutsOrError.advance;
					cardList.layouts = layoutsOrError.layouts;
				} else {
					let slotName = header;
					// Header with card count: Default layout.
					const match = header.match(/([a-zA-Z]+)\s*\((\d+)\)/);
					if (match) {
						if (cardList.layouts && !cardList.layouts["default"]) {
							return ackError({
								title: `Parsing Error`,
								text: `Default layout (defining slot sizes in their headers) and custom layouts should not be mixed.`,
							});
						}
						if (!cardList.layouts) cardList.layouts = {};
						if (!cardList.layouts["default"]) cardList.layouts["default"] = { weight: 1, slots: {} };
						slotName = match[1];
						cardList.layouts["default"].slots[slotName] = parseInt(match[2]);
					}
					cardList.slots[slotName] = {};
					const parseLineOptions = Object.assign({ customCards: cardList.customCards }, options);
					while (lineIdx < lines.length && lines[lineIdx][0] !== "[") {
						if (lines[lineIdx]) {
							const result = parseLine(lines[lineIdx], parseLineOptions);
							if (isSocketError(result)) {
								// Just ignore the missing card and add it to the list of errors
								if (options?.ignoreUnknownCards) outIgnoredCards?.push(lines[lineIdx]);
								else return result;
							} else {
								const { count, cardID, foil } = result;
								// Merge duplicate declarations
								if (Object.prototype.hasOwnProperty.call(cardList.slots[slotName], cardID))
									cardList.slots[slotName][cardID] += count;
								else cardList.slots[slotName][cardID] = count;
							}
						}
						++lineIdx;
					}
				}
			}
			// Check layout declarations
			if (cardList.layouts) {
				let commonPackSize = -1;
				for (const layoutName in cardList.layouts) {
					let packSize = 0;
					for (const slotName in cardList.layouts[layoutName].slots) {
						if (!Object.prototype.hasOwnProperty.call(cardList.slots, slotName)) {
							return ackError({
								title: `Parsing Error`,
								text: `Layout ${layoutName} refers to slot ${slotName} which is not defined.`,
							});
						}
						packSize += cardList.layouts[layoutName].slots[slotName];
					}
					if (commonPackSize == -1) commonPackSize = packSize;
					else if (commonPackSize != packSize) {
						return ackError({
							title: `Parsing Error`,
							text: `All layouts must contains the same total number of cards.`,
						});
					}
				}
			} else {
				// No explicit or default (via slot sizes) layout, expect a single slot.
				if (Object.keys(cardList.slots).length === 0)
					return ackError({
						title: `Parsing Error`,
						text: `No slot defined.`,
					});
				else if (Object.keys(cardList.slots).length !== 1)
					return ackError({
						title: `Parsing Error`,
						text: `Multiple 'default' slots defined. Merge them into a single one, or use layouts (you can define a default layout by explicitly setting slot sizes).`,
					});
			}
		} else {
			cardList.slots["default"] = {};
			for (const line of lines) {
				if (line) {
					const result = parseLine(line, options);
					if (isSocketError(result)) {
						// Just ignore the missing card and add it to the list of errors
						if (options?.ignoreUnknownCards) outIgnoredCards?.push(line);
						else return result; // Return error from parseLine
					} else {
						const { count, cardID, foil } = result;
						// Merge duplicate declarations
						if (Object.prototype.hasOwnProperty.call(cardList.slots["default"], cardID))
							cardList.slots["default"][cardID] += count;
						else cardList.slots["default"][cardID] = count;
					}
				}
			}
			cardList.layouts = false;
		}
		if (options?.name) cardList.name = options.name;
		if (Object.keys(cardList.slots).every((key) => cardList.slots[key].length === 0))
			return ackError({
				title: "Empty List",
				text: `Supplied card list is empty.`,
			});
		return cardList;
	} catch (e) {
		return ackError({
			title: "Parsing Error",
			text: "An error occurred during parsing, please check you input file.",
			footer: "Full error: " + e,
		});
	}
}

const XMageLine = /(\d+) \[([^:]+):([^\]]+)\] (.*)/i;
export function XMageToArena(txt: string) {
	let r = "";
	for (const line of txt.split("\n")) {
		if (line === "") {
			r += "\n";
		} else {
			const match = XMageLine.exec(line);
			if (!match) return false;
			else r += `${match[1]} ${match[4]} (${match[2]}) ${match[3]}\n`;
		}
	}
	return r;
}

export default parseCardList;
