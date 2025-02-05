"use strict";
import { v1 as uuidv1 } from "uuid";
import { before, after, beforeEach, afterEach, describe, it } from "mocha";
import fs from "fs";
import chai from "chai";
const expect = chai.expect;
import { Cards, getCard } from "../src/Cards.js";
import { Connections } from "../src/Connection.js";
import { Sessions } from "../src/Session.js";
import { Random, nodeCrypto } from "random-js";
import {
	connectClient,
	makeClients,
	enableLogs,
	disableLogs,
	waitForSocket,
	waitForClientDisconnects,
	ackNoError,
	ValidCubes,
	getUID,
} from "./src/common.js";
import { Constants } from "../src/Constants.js";
import type { DistributionMode } from "../src/Session/SessionTypes";
import { ReadyState } from "../src/Session/SessionTypes.js";

const checkColorBalance = function (booster: Card[]) {
	for (const color of "WUBRG")
		expect(
			booster.filter((card) => card.rarity === "common" && card.colors.includes(color as CardColor)).length
		).to.be.at.least(1);
};

const checkDuplicates = function (booster: UniqueCard[]) {
	// Foils can be duplicates
	const sorted = [...booster].sort((lhs, rhs) => (lhs.id < rhs.id ? -1 : 1));
	for (let idx = 0; idx < sorted.length - 1; ++idx) {
		const test = sorted[idx].id === sorted[idx + 1].id && sorted[idx].foil === sorted[idx + 1].foil;
		if (test) {
			console.error("Duplicates found: ");
			console.error(sorted[idx]);
			console.error(sorted[idx + 1]);
		}
		expect(test).to.be.false;
	}
};

const CustomSlotsTestFile = fs.readFileSync(`./test/data/CustomSheets.txt`, "utf8");
const CustomLayoutsTestFile = fs.readFileSync(`./test/data/CustomLayouts.txt`, "utf8");
const CustomLayouts_MixedLayoutDefinitionsTestFile = fs.readFileSync(
	`./test/data/CustomLayouts_MixedLayoutDefinitions.txt`,
	"utf8"
);
const CustomCards_NoLayout = fs.readFileSync(`./test/data/CustomCards_NoLayout.txt`, "utf8");
const CustomCards_SlotSize = fs.readFileSync(`./test/data/CustomCards_SlotSize.txt`, "utf8");
const CustomCards_MultipleDefaultSlots_Invalid = fs.readFileSync(
	`./test/data/CustomCards_MultipleDefaultSlots_Invalid.txt`,
	"utf8"
);
const WithReplacement = fs.readFileSync(`./test/data/ReplacementTest.txt`, "utf8");
const WithReplacementLayouts = fs.readFileSync(`./test/data/ReplacementTest_Layouts.txt`, "utf8");

describe("Inter client communication", function () {
	const sessionID = "sessionID";
	let clients: ReturnType<typeof makeClients> = [];
	let ownerIdx = 0,
		nonOwnerIdx = 0;

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	before(function (done) {
		disableLogs();
		expect(Object.keys(Connections).length).to.equal(0);
		clients = makeClients(
			[
				{
					userID: "id0",
					sessionID: sessionID,
					userName: "name0",
				},
				{
					userID: "id1",
					sessionID: sessionID,
					userName: "name1",
				},
			],
			() => {
				ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
				nonOwnerIdx = 1 - ownerIdx;
				enableLogs(false);
				done();
			}
		);
	});

	after(function (done) {
		disableLogs();
		for (const c of clients) c.disconnect();
		waitForClientDisconnects(done);
	});

	describe("Chat Events", function () {
		const text = "Text Value";
		it("Clients should receive a message when the `chatMessage` event is emited.", function (done) {
			clients[nonOwnerIdx].once("chatMessage", function (msg) {
				expect(msg.text).to.equal(text);
				done();
			});
			clients[ownerIdx].emit("chatMessage", { author: clients[ownerIdx].id, text: text, timestamp: Date.now() });
		});
	});

	describe("Ready Check", function () {
		it("Clients should receive a readyCheck event when the owner send a readyCheck event to the server.", function (done) {
			clients[nonOwnerIdx].once("readyCheck", done);
			clients[ownerIdx].emit("readyCheck", ackNoError);
		});

		it("Sender status should be dispatched to other users.", function (done) {
			clients[nonOwnerIdx].once("setReady", (userID, status) => {
				expect(userID).to.equal((clients[ownerIdx] as any).query.userID);
				expect(status).to.equal("Ready");
				done();
			});
			clients[ownerIdx].emit("setReady", ReadyState.Ready);
		});

		it("Receiver status should be dispatched to other users.", function (done) {
			clients[ownerIdx].once("setReady", (userID, status) => {
				expect(userID).to.equal((clients[nonOwnerIdx] as any).query.userID);
				expect(status).to.equal("Ready");
				done();
			});
			clients[nonOwnerIdx].emit("setReady", ReadyState.Ready);
		});
	});

	describe("Personal options updates", function () {
		it("Clients should receive the updated userName when a user changes it.", function (done) {
			clients[nonOwnerIdx].once("updateUser", function (data) {
				expect(data.userID).to.equal((clients[ownerIdx] as any).query.userID);
				expect(data.updatedProperties.userName).to.equal("senderUpdatedUserName");
				done();
			});
			clients[ownerIdx].emit("setUserName", "senderUpdatedUserName");
		});
		it("Clients should receive the updated useCollection status.", function (done) {
			clients[nonOwnerIdx].once("updateUser", function (data) {
				expect(data.userID).to.equal((clients[ownerIdx] as any).query.userID);
				expect(data.updatedProperties.useCollection).to.equal(false);
				done();
			});
			clients[ownerIdx].emit("useCollection", false);
		});
		it("Clients should NOT receive an update if the option is not actually changed.", function (done) {
			const timeout = setTimeout(() => {
				clients[nonOwnerIdx].removeListener("updateUser");
				done();
			}, 200);
			clients[nonOwnerIdx].once("updateUser", () => {
				clearTimeout(timeout);
				done(new Error("Unexpected Call"));
			});
			clients[ownerIdx].emit("useCollection", false);
		});
		it("Clients should receive the updated useCollection status.", function (done) {
			clients[nonOwnerIdx].once("updateUser", function (data) {
				expect(data.userID).to.equal((clients[ownerIdx] as any).query.userID);
				expect(data.updatedProperties.useCollection).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("useCollection", true);
		});
		it("Clients should receive the updated userName.", function (done) {
			clients[nonOwnerIdx].once("updateUser", function (data) {
				expect(data.userID).to.equal((clients[ownerIdx] as any).query.userID);
				expect(data.updatedProperties.userName).to.equal("Sender New UserName");
				done();
			});
			clients[ownerIdx].emit("setUserName", "Sender New UserName");
		});

		it("Clearing sessionOptions events (We fire at least one on connection and don't want it to linger).", function (done) {
			clients[nonOwnerIdx].on("sessionOptions", () => {});
			clients[nonOwnerIdx].removeListener("sessionOptions");
			done();
		});

		// Session settings
		it("Clients should receive the updated boosterContent.", function (done) {
			const newBoosterContent = { common: 2, uncommon: 58, rare: 36, bonus: 1 };
			clients[nonOwnerIdx].once("sessionOptions", (data) => {
				expect(data.boosterContent).to.eql(newBoosterContent);
				done();
			});

			clients[ownerIdx].emit("setBoosterContent", newBoosterContent);
		});
		it("Clients should receive the updated maxDuplicates.", function (done) {
			const newMaxDuplicates = { common: 5, uncommon: 4, rare: 1, mythic: 1 };
			clients[nonOwnerIdx].once("sessionOptions", function (options) {
				expect(options.maxDuplicates).to.eql(newMaxDuplicates);
				done();
			});
			clients[ownerIdx].emit("setMaxDuplicates", newMaxDuplicates);
		});

		it("Removing non-owner.", function (done) {
			clients[nonOwnerIdx].once("setSession", function (newID) {
				expect(Sessions[sessionID].users.size).to.equal(1);
				expect(Sessions[sessionID].users).to.not.include((clients[nonOwnerIdx] as any).query.userID);
				expect(newID).to.not.equal(sessionID);
				done();
			});
			clients[ownerIdx].emit("removePlayer", (clients[nonOwnerIdx] as any).query.userID);
		});
	});
});

describe("Sets content", function () {
	let clients: ReturnType<typeof makeClients> = [];
	const sessionID = "sessionID";

	const sets: { [code: SetCode]: { [rarity: string]: number } } = {
		dom: { common: 101, uncommon: 80, rare: 53, mythic: 15 },
		grn: { common: 111, uncommon: 80, rare: 53, mythic: 15 },
		rna: { common: 111, uncommon: 80, rare: 53, mythic: 15 },
		war: { common: 101, uncommon: 80, rare: 53, mythic: 15 },
		eld: { common: 101, uncommon: 80, rare: 53, mythic: 15 },
		thb: { common: 101, uncommon: 80, rare: 53, mythic: 15 },
		iko: { common: 111, uncommon: 80, rare: 53, mythic: 15 },
		m21: { common: 111, uncommon: 80, rare: 53, mythic: 15 },
		akr: { common: 108, uncommon: 90, rare: 74, mythic: 31 },
		znr: { common: 101, uncommon: 80, rare: 64, mythic: 20 },
		klr: { common: 104, uncommon: 97, rare: 63, mythic: 23 - 1 }, // Exclude the Buy-a-Box mythic
		khm: { common: 111, uncommon: 80, rare: 64, mythic: 20 },
		tsr: { common: 121, uncommon: 100, rare: 53, mythic: 15 },
		stx: { common: 105, uncommon: 80, rare: 69, mythic: 21 },
		mh2: { common: 101, uncommon: 100, rare: 78, mythic: 24 },
		afr: { common: 101, uncommon: 80, rare: 60, mythic: 20 },
		//j21: { common: 383 + 20, uncommon: 286, rare: 85, mythic: 13 }, // The 20 added common are additional lands
		mid: { common: 100, uncommon: 83, rare: 64, mythic: 20 },
		vow: { common: 100, uncommon: 83, rare: 64, mythic: 20 },
		snc: { common: 101, uncommon: 80, rare: 60, mythic: 20 },
		clb: { common: 141, uncommon: 120, rare: 77, mythic: 22, special: 1 },
		"2x2": { common: 91, uncommon: 80, rare: 120, mythic: 40 },
		dmu: { common: 101, uncommon: 80, rare: 60, mythic: 20 },
		bro: { common: 101, uncommon: 80, rare: 63, mythic: 23 },
		dmr: { common: 101 + 24, uncommon: 80 + 36, rare: 60 + 60, mythic: 20 + 20 }, // Includes retro frame cards
		one: { common: 101, uncommon: 80, rare: 60, mythic: 20 },
		sir: { common: 94, uncommon: 93, rare: 66, mythic: 23 },
		mom: { common: 116, uncommon: 80, rare: 60, mythic: 20 },
		ltr: { common: 101, uncommon: 80, rare: 60, mythic: 20 },
	};

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	before(function (done) {
		clients = makeClients(
			[
				{
					userID: "id1",
					sessionID: sessionID,
					userName: "Client1",
				},
				{
					userID: "id2",
					sessionID: sessionID,
					userName: "Client2",
				},
			],
			done
		);
	});

	after(function (done) {
		disableLogs();
		for (const c of clients) c.disconnect();
		waitForClientDisconnects(done);
	});

	it("2 clients with different userID should be connected.", function (done) {
		expect(Object.keys(Connections)).to.have.lengthOf(2);
		done();
	});

	for (const set in sets) {
		it(`Checking ${set}`, function (done) {
			const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			const nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("setRestriction", () => {
				const localCollection = Sessions[sessionID].cardPoolByRarity();
				const errors: string[] = []; // Log all errors before exiting.
				for (const r in sets[set]) {
					const cardIDs = [...localCollection[r].keys()];
					if (cardIDs.length !== sets[set][r]) {
						errors.push(`Incorrect card count for set ${set}, ${r}: ${cardIDs.length}/${sets[set][r]}`);
					}
					if (set !== "one")
						expect(cardIDs.map((cid) => getCard(cid).set).every((s) => s === set)).to.be.true;
					// expect(cardIDs).to.have.lengthOf(sets[set][r]); // FIXME: For some reason, this times out on error, instead of correctly reporting the error
				}
				expect(errors, errors.join("\n")).to.be.lengthOf(0);
				done();
			});
			clients[ownerIdx].emit("ignoreCollections", true);
			clients[ownerIdx].emit("setRestriction", [set]);
			// Wait for request to arrive
		});
	}
});

describe("Single Player Draft", function () {
	let client: Socket<ServerToClientEvents, ClientToServerEvents>;
	let state: ReturnType<DraftState["syncData"]> = {
		booster: [],
		boosterCount: 0,
		boosterNumber: 0,
		pickNumber: 0,
		skipPick: false,
	};

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	it("Client connects.", function (done) {
		const sessionID = uuidv1();
		client = makeClients(
			[
				{
					userID: "id1",
					sessionID: sessionID,
					userName: "Client1",
				},
			],
			() => {
				expect(Connections).to.have.property("id1");
				expect(Object.keys(Connections).length).to.equal(1);
				done();
			}
		)[0];
	});

	it("Set bot count.", function (done) {
		client.emit("setBots", 7);
		done();
	});

	it("Start Draft", function (done) {
		client.once("draftState", (state) => {
			const s = state as ReturnType<DraftState["syncData"]>;
			expect(s.booster).to.exist;
			state = s;
			done();
		});

		client.emit("startDraft", ackNoError);
	});

	it("Pick until draft ends.", (done) => {
		client.once("endDraft", function () {
			client.removeListener("draftState");
			done();
		});
		client.on("draftState", function (_s) {
			const s = _s as ReturnType<DraftState["syncData"]>;
			if (s.pickNumber !== state.pickNumber && s.boosterCount > 0) {
				state = s;
				client.emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
			}
		});
		client.emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
	});

	it("Start Draft and immediatly disconnects.", function (done) {
		client.once("draftState", (state) => {
			const s = state as ReturnType<DraftState["syncData"]>;
			expect(s.booster).to.exist;
			state = s;
			client.disconnect();
			done();
		});

		client.emit("startDraft", ackNoError);
	});

	it("Reconnects, draft restarts.", function (done) {
		client.once("resumeOnReconnection", () => done());
		client.connect();
	});

	it("Pick until draft ends.", (done) => {
		client.once("endDraft", () => {
			client.removeListener("draftState");
			done();
		});
		client.on("draftState", (_s) => {
			const s = _s as ReturnType<DraftState["syncData"]>;
			if (s.pickNumber !== state.pickNumber && s.boosterCount > 0) {
				state = s;
				client.emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
			}
		});
		client.emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
	});

	it("Client should disconnect.", function (done) {
		client.disconnect();
		waitForClientDisconnects(() => done());
	});
});

describe("Single Draft (Two Players)", function () {
	let clients: ReturnType<typeof makeClients> = [];
	let sessionID = "sessionID";
	let ownerIdx = 0;
	let nonOwnerIdx = 0;
	const clientStates: { [uid: UserID]: { pickedCards: UniqueCard[]; state: ReturnType<DraftState["syncData"]> } } =
		{};

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	function connect(sid?: string) {
		it("2 clients with different userIDs should be connected.", function (done) {
			sessionID = sid ?? uuidv1();
			clients = makeClients(
				[
					{
						userID: "id1",
						sessionID: sessionID,
						userName: "Client1",
					},
					{
						userID: "id2",
						sessionID: sessionID,
						userName: "Client2",
					},
				],
				() => {
					expect(Connections).to.have.property("id1");
					expect(Connections).to.have.property("id2");
					expect(Object.keys(Connections).length).to.equal(2);
					ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
					nonOwnerIdx = 1 - ownerIdx;
					done();
				}
			);
		});
	}

	function disconnect(callback = () => {}) {
		it("Clients should disconnect.", function (done) {
			disableLogs();
			for (const c of clients) {
				c.disconnect();
			}

			waitForClientDisconnects(() => {
				callback();
				done();
			});
		});
	}

	function startDraft() {
		it("When session owner launches draft, everyone should receive a startDraft event", function (done) {
			let connectedClients = 0;
			let receivedBoosters = 0;
			for (const c of clients) {
				c.once("startDraft", () => {
					connectedClients += 1;
					if (connectedClients === clients.length && receivedBoosters === clients.length) done();
				});

				c.once("draftState", (state) => {
					const s = state as ReturnType<DraftState["syncData"]>;
					expect(s.booster).to.exist;
					clientStates[getUID(c)] = { state: s, pickedCards: [] };
					receivedBoosters += 1;
					if (connectedClients === clients.length && receivedBoosters === clients.length) done();
				});
			}
			clients[ownerIdx].emit("startDraft", ackNoError);
		});
	}

	function singlePick(boosterValidation?: (booster: UniqueCard[]) => void) {
		it("Once everyone in a session has picked a card, receive next boosters.", (done) => {
			let receivedBoosters = 0;
			for (const client of clients) {
				client.on("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					const clientState = clientStates[getUID(client)];
					if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
						if (s.pickNumber === 0) boosterValidation?.(s.booster);
						++receivedBoosters;
						expect(s.booster.length).to.equal(clientState.state.booster.length - 1);
						clientState.state = s;
						if (receivedBoosters === clients.length) {
							for (const c2 of clients) c2.removeListener("draftState");
							done();
						}
					}
				});
			}
			for (const client of clients) {
				clientStates[getUID(client)].pickedCards.push(clientStates[getUID(client)].state.booster[0]);
				client.emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
			}
		});
	}

	function endDraft(boosterValidation?: (booster: UniqueCard[]) => void) {
		it("Pick enough times, and the draft should end.", function (done) {
			let draftEnded = 0;
			for (const client of clients) {
				client.on("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					const clientState = clientStates[getUID(client)];
					if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
						if (s.pickNumber === 0) {
							expect(
								s.booster.every((card) => card !== undefined),
								"Booster should not hold any undefined value."
							).to.be.true;
							expect(
								s.booster.every((card) => card.image_uris["en"] !== undefined),
								`All cards in booster should have a valid image.\n${s.booster
									.filter((card) => card.image_uris["en"] === undefined)
									.map((card) => `${card.name} (${card.id})`)
									.join("\n")}`
							).to.be.true;
							boosterValidation?.(s.booster);
						}
						const choice = Math.floor(Math.random() * s.booster.length);
						clientState.pickedCards.push(s.booster[choice]);
						clientState.state = s;
						client.emit("pickCard", { pickedCards: [choice], burnedCards: [] }, ackNoError);
					}
				});
				client.once("endDraft", function () {
					draftEnded += 1;
					client.removeListener("draftState");
					if (draftEnded === clients.length) {
						done();
					}
				});
			}
			for (const client of clients) {
				const clientState = clientStates[getUID(client)];
				const choice = Math.floor(Math.random() * clientState.state.booster.length);
				clientState.pickedCards.push(clientState.state.booster[choice]);
				client.emit("pickCard", { pickedCards: [choice], burnedCards: [] }, ackNoError);
			}
		});
	}

	function expectCardCount(cardCount: number) {
		it(`Each player should have ${cardCount} cards`, function (done) {
			for (let c = 0; c < clients.length; ++c) {
				const clientState = clientStates[getUID(clients[c])];
				expect(clientState.pickedCards.length).to.equal(cardCount);
			}
			done();
		});
	}

	describe("With a third player and color balance", function () {
		connect();
		it("3 clients with different userIDs should be connected.", function (done) {
			const idx = clients.push(
				connectClient({
					userID: "id3",
					sessionID: sessionID,
					userName: "Client3",
				})
			);

			clients[idx - 1].on("connect", function () {
				expect(Object.keys(Connections).length).to.equal(3);
				done();
			});
		});

		it(`Card Pool should be all of THB set`, function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[ownerIdx].emit("setColorBalance", true);
			clients[ownerIdx].emit("ignoreCollections", true);
			clients[nonOwnerIdx].once("setRestriction", () => {
				const localCollection = Sessions[sessionID].cardPoolByRarity();
				expect([...localCollection["common"]]).to.have.lengthOf(101);
				expect([...localCollection["uncommon"]]).to.have.lengthOf(80);
				expect([...localCollection["rare"]]).to.have.lengthOf(53);
				expect([...localCollection["mythic"]]).to.have.lengthOf(15);
				done();
			});
			clients[ownerIdx].emit("setRestriction", ["thb"]);
		});
		startDraft();
		const boosterValidation = (booster: UniqueCard[]) => {
			checkColorBalance(booster);
			checkDuplicates(booster);
		};
		singlePick(boosterValidation);
		endDraft(boosterValidation);
		expectCardCount(3 * 15);
		disconnect();
	});

	for (const set of Constants.PrimarySets) {
		describe(`Drafting ${set}`, function () {
			connect(set);
			it("Clients should receive the updated setRestriction status.", function (done) {
				const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
				const nonOwnerIdx = 1 - ownerIdx;
				clients[nonOwnerIdx].once("setRestriction", function (setRestriction) {
					expect(setRestriction).to.have.lengthOf(1);
					expect(setRestriction[0]).to.be.equal(set);
					done();
				});
				clients[ownerIdx].emit("ignoreCollections", true);
				clients[ownerIdx].emit("setRestriction", [set]);
			});
			startDraft();
			endDraft((b) => {
				checkDuplicates(b);
				expect(
					b.every(
						(c) =>
							c.set === set ||
							(set === "sir" && c.set === "sis") ||
							(set === "sir0" && c.set === "sir") ||
							c.set === "sis" ||
							(set === "sir1" && c.set === "sir") ||
							c.set === "sis" ||
							(set === "sir2" && c.set === "sir") ||
							c.set === "sis" ||
							(set === "sir3" && c.set === "sir") ||
							c.set === "sis" ||
							(set === "ydmu" && c.set === "dmu") ||
							(set === "planeshifted_snc" && c.set === "snc") ||
							(set === "mb1_convention_2019" && ["mb1", "cmb1"].includes(c.set)) ||
							(set === "mb1_convention_2021" && ["mb1", "cmb2"].includes(c.set)) ||
							(set === "unf" && c.set === "sunf") ||
							(set === "con" && c.set === "ala") ||
							(set === "arb" && c.set === "ala") ||
							(set === "wwk" && c.set === "zen") ||
							(set === "dka" && c.set === "isd") ||
							(set === "gtc" && c.set === "rtr") ||
							(set === "bng" && c.set === "ths") ||
							(set === "jou" && c.set === "ths") ||
							(set === "ogw" && c.set === "bfz") ||
							(set === "emn" && c.set === "soi") ||
							(set === "aer" && c.set === "kld") ||
							(set === "mb1" && c.set === "fmb1") ||
							(set === "tsp" && c.set === "tsb") ||
							(set === "frf" && c.set === "ktk") ||
							(set === "dgm" && (c.set === "gtc" || c.set === "rtr")) ||
							(set === "stx" && c.set === "sta") ||
							(set === "bro" && c.set === "brr") ||
							(set === "one" && ["neo", "dmu", "snc", "khm"].includes(c.set)) || // Praetors
							(set === "mom" && c.set === "mul") ||
							(set === "mat" && (c.set === "mul" || c.set === "mom"))
					),
					`All cards in booster should be of the desired set, got [${[...new Set(b.map((c) => c.set))]}].`
				).to.be.true;
			});
			disconnect();
		});
	}

	const latestSetCardPerBooster: number = 14;

	describe(`Drafting without set restriction`, function () {
		connect();
		it("Clients should receive the updated setRestriction status.", function (done) {
			const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			const nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("setRestriction", function (setRestriction) {
				expect(setRestriction).to.have.lengthOf(0);
				done();
			});
			clients[ownerIdx].emit("ignoreCollections", true);
			clients[ownerIdx].emit("setRestriction", []);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * 14);
		disconnect();
	});

	describe("Without color balance", function () {
		connect();
		it("Clients should receive the updated colorBalance status.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (options) {
				expect(options.colorBalance).to.equal(false);
				done();
			});
			clients[ownerIdx].emit("setColorBalance", false);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * latestSetCardPerBooster);
		disconnect();
	});

	describe("Discarding the 8 remaining cards of each pack", function () {
		connect();
		const discardRemainingCardsAt = 8;
		const cardsPerPack = 15; // Drafting BRO to make sure we have 15 cards per pack
		it("Clients should receive the updated setRestriction status.", function (done) {
			const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			const nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("setRestriction", function (setRestriction) {
				expect(setRestriction).to.have.lengthOf(1);
				expect(setRestriction[0]).to.be.equal("bro");
				done();
			});
			clients[ownerIdx].emit("ignoreCollections", true);
			clients[ownerIdx].emit("setRestriction", ["bro"]);
		});
		it("Clients should receive the updated discardRemainingCardsAt status.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (options) {
				expect(options.discardRemainingCardsAt).to.equal(discardRemainingCardsAt);
				done();
			});
			clients[ownerIdx].emit("setDiscardRemainingCardsAt", discardRemainingCardsAt);
		});
		startDraft();
		it(`Packs should be 15 cards.`, function (done) {
			expect((Sessions[sessionID].draftState as DraftState).boosters[0].length).to.equal(15);
			done();
		});
		for (let i = 0; i < cardsPerPack - discardRemainingCardsAt - 1; i++) {
			singlePick();
		}
		it(`Draft should advance to the next pack after cardPerBooster - ${discardRemainingCardsAt} picks.`, function (done) {
			let receivedBoosters = 0;
			for (let c = 0; c < clients.length; ++c) {
				const clientState = clientStates[getUID(clients[c])];
				clients[c].on("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
						clients[c].removeListener("draftState");
						receivedBoosters += 1;
						expect(s.booster.length).to.equal(cardsPerPack);
						expect(s.boosterNumber).to.equal(1);
						clientState.state = s;
						if (receivedBoosters === clients.length) done();
					}
				});
				clientState.pickedCards.push(clientState.state.booster[0]);
				clients[c].emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
			}
		});
		endDraft();
		expectCardCount(3 * (15 - 8));
		disconnect();
	});

	describe("With Bots", function () {
		connect();
		it("Clients should receive the updated bot count.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(6);
				done();
			});
			clients[ownerIdx].emit("setBots", 6);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * latestSetCardPerBooster);
		disconnect();
	});

	describe("With Bots and foils", function () {
		connect();
		it("Clients should receive the updated bot count.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(6);
				done();
			});
			clients[ownerIdx].emit("setBots", 6);
		});
		it("Clients should receive the updated session option (foil).", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.foil).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setFoil", true);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * latestSetCardPerBooster);
		disconnect();
	});

	describe("With Bots and Disconnect", function () {
		connect();
		it("Clients should receive the updated bot count.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(6);
				done();
			});
			clients[ownerIdx].emit("setBots", 6);
		});

		startDraft();

		it("Non-owner disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", function () {
				waitForSocket(clients[nonOwnerIdx], done);
			});
			clients[nonOwnerIdx].disconnect();
		});

		it("Non-owner reconnects, draft restarts.", function (done) {
			clients[ownerIdx].once("resumeOnReconnection", function () {
				done();
			});
			clients[nonOwnerIdx].connect();
		});

		singlePick();

		it("Non-owner disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", function () {
				waitForSocket(clients[nonOwnerIdx], done);
			});
			clients[nonOwnerIdx].disconnect();
		});

		it("Non-owner reconnects and receives an appropriate event.", function (done) {
			clients[nonOwnerIdx].once("rejoinDraft", function (data) {
				expect(data.pickedCards.main.length).to.equal(1);
				expect(data.pickedCards.side.length).to.equal(0);
				done();
			});
			clients[nonOwnerIdx].connect();
		});

		endDraft();
		expectCardCount(3 * latestSetCardPerBooster);
		disconnect();
	});

	describe("With Disconnect and replacing with bots", function () {
		connect();
		startDraft();

		it("Non-owner disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", function () {
				waitForSocket(clients[nonOwnerIdx], done);
			});
			clients[nonOwnerIdx].disconnect();
		});

		it("Non-owner reconnects, draft restarts.", function (done) {
			clients[ownerIdx].once("resumeOnReconnection", function () {
				done();
			});
			clients[nonOwnerIdx].connect();
		});

		singlePick();

		it("Non-owner disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", function () {
				waitForSocket(clients[nonOwnerIdx], done);
			});
			clients[nonOwnerIdx].disconnect();
		});

		it("Non-owner is replaced by a bot.", function (done) {
			clients[ownerIdx].once("resumeOnReconnection", () => done());
			clients[ownerIdx].emit("replaceDisconnectedPlayers");
		});

		const ownerPick = () => {
			it("Owner pick alone.", (done) => {
				clients[ownerIdx].on("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					const clientState = clientStates[getUID(clients[ownerIdx])];
					if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
						expect(s.booster.length).to.equal(clientState.state.booster.length - 1);
						clientState.state = s;
						clients[ownerIdx].removeListener("draftState");
						done();
					}
				});
				clientStates[getUID(clients[ownerIdx])].pickedCards.push(
					clientStates[getUID(clients[ownerIdx])].state.booster[0]
				);
				clients[ownerIdx].emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
			});
		};
		ownerPick();
		ownerPick();
		ownerPick();

		it("Non-owner reconnects and receives an appropriate event, bot picked 3 cards for them.", function (done) {
			clients[nonOwnerIdx].once("rejoinDraft", function (data) {
				expect(data.pickedCards.main.length).to.equal(5);
				expect(data.pickedCards.side.length).to.equal(0);
				clientStates[getUID(clients[nonOwnerIdx])].pickedCards = data.pickedCards.main;
				clientStates[getUID(clients[nonOwnerIdx])].state = data.state;
				done();
			});
			clients[nonOwnerIdx].connect();
		});

		it("Owner pick, non-owner should receive a new booster.", (done) => {
			let receivedBoosters = 0;
			for (const client of clients) {
				client.once("draftState", function (state) {
					const clientState = clientStates[getUID(client)];
					++receivedBoosters;
					clientState.state = state as ReturnType<DraftState["syncData"]>;
					if (receivedBoosters === clients.length) done();
				});
			}
			clientStates[getUID(clients[ownerIdx])].pickedCards.push(
				clientStates[getUID(clients[ownerIdx])].state.booster[0]
			);
			clients[ownerIdx].emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
		});

		endDraft();
		expectCardCount(3 * latestSetCardPerBooster);
		disconnect();
	});

	describe("With Disconnect, 3 players, replacing with bots and no reconnect.", function () {
		connect();
		it("3 clients with different userIDs should be connected.", function (done) {
			const idx = clients.push(
				connectClient({
					userID: "id3",
					sessionID: sessionID,
					userName: "Client3",
				})
			);

			clients[idx - 1].on("connect", function () {
				expect(Object.keys(Connections).length).to.equal(3);
				done();
			});
		});
		startDraft();

		singlePick();

		it("Non-owner disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", () => waitForSocket(clients[nonOwnerIdx], done));
			clients[nonOwnerIdx].disconnect();
		});

		it("Non-owner reconnects, draft restarts.", function (done) {
			clients[ownerIdx].once("resumeOnReconnection", () => done());
			clients[nonOwnerIdx].connect();
		});

		singlePick();
		singlePick();

		it("Third player disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", () => waitForSocket(clients[2], done));
			clients[2].disconnect();
		});

		it("Non-owner disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", () => waitForSocket(clients[nonOwnerIdx], done));
			clients[nonOwnerIdx].disconnect();
		});

		it("Non-owners are replaced by bots.", function (done) {
			clients[ownerIdx].once("resumeOnReconnection", () => done());
			clients[ownerIdx].emit("replaceDisconnectedPlayers");
		});

		it("Owner ends the draft alone.", (done) => {
			clients[ownerIdx].once("endDraft", function () {
				clients[ownerIdx].removeListener("draftState");
				expect(clientStates[getUID(clients[ownerIdx])].pickedCards.length).to.equal(
					3 * latestSetCardPerBooster
				);
				done();
			});
			clients[ownerIdx].on("draftState", function (state) {
				const s = state as ReturnType<DraftState["syncData"]>;
				const clientState = clientStates[getUID(clients[ownerIdx])];
				if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
					clientState.state = s;
					clientStates[getUID(clients[ownerIdx])].pickedCards.push(
						clientStates[getUID(clients[ownerIdx])].state.booster[0]
					);
					clients[ownerIdx].emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
				}
			});
			clientStates[getUID(clients[ownerIdx])].pickedCards.push(
				clientStates[getUID(clients[ownerIdx])].state.booster[0]
			);
			clients[ownerIdx].emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
		});

		disconnect();
	});

	describe("Checking card movement and reconnect", function () {
		connect();

		it("Owner will spectate.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (options) {
				expect(options.ownerIsPlayer).to.equal(false);
				done();
			});
			clients[ownerIdx].emit("setOwnerIsPlayer", false);
		});

		it("Clients should receive the updated bot count.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(3);
				done();
			});
			clients[ownerIdx].emit("setBots", 3);
		});

		it("When session owner launches draft, everyone should receive a startDraft event", function (done) {
			let connectedClients = 0;
			let receivedBoosters = 0;
			for (const c in clients) {
				clients[c].once("startDraft", function () {
					connectedClients += 1;
					if (connectedClients === clients.length && receivedBoosters === 1) done();
				});
			}

			// Only the players will receive a draftState event
			clients[nonOwnerIdx].once("draftState", function (state) {
				const s = state as ReturnType<DraftState["syncData"]>;
				expect(s.booster).to.exist;
				clientStates[getUID(clients[nonOwnerIdx])] = { state: s, pickedCards: [] };
				receivedBoosters += 1;
				if (connectedClients === clients.length && receivedBoosters === 1) done();
			});

			clients[ownerIdx].emit("startDraft", ackNoError);
		});

		let lastPickedCardUID: number;

		it("Player makes a single pick.", function (done) {
			const clientState = clientStates[(clients[nonOwnerIdx] as any).query.userID];
			clients[nonOwnerIdx].on("draftState", function (state) {
				const s = state as ReturnType<DraftState["syncData"]>;
				if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
					expect(s.booster.length).to.equal(clientState.state.booster.length - 1);
					clientState.state = s;
					clients[nonOwnerIdx].removeListener("draftState");
					done();
				}
			});
			lastPickedCardUID = clientState.state.booster[0].uniqueID;
			clientState.pickedCards.push(clientState.state.booster[0]);
			clients[nonOwnerIdx].emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
		});

		it("Non-owner moves a card to the side board, spectator receives an update.", function (done) {
			clients[ownerIdx].once("draftLogLive", function (data) {
				expect(data.userID).to.equal(getUID(clients[nonOwnerIdx]));
				expect((data.decklist as DeckList).main.length).to.equal(0);
				expect((data.decklist as DeckList).side.length).to.equal(1);
				done();
			});
			clients[nonOwnerIdx].emit("moveCard", lastPickedCardUID, "side");
		});

		it("Non-owner disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", function () {
				waitForSocket(clients[nonOwnerIdx], done);
			});
			clients[nonOwnerIdx].disconnect();
		});

		it("Non-owner reconnects and receives an appropriate event.", function (done) {
			const clientState = clientStates[getUID(clients[nonOwnerIdx])];
			clients[nonOwnerIdx].once("rejoinDraft", function (data) {
				expect(data.pickedCards.main.length).to.equal(0);
				expect(data.pickedCards.side.length).to.equal(1);
				clientState.state = data.state;
				clientState.pickedCards = data.pickedCards.main;
				done();
			});
			clients[nonOwnerIdx].connect();
		});

		it("Pick enough times, and the draft should end.", function (done) {
			const clientState = clientStates[getUID(clients[nonOwnerIdx])];
			clients[nonOwnerIdx].on("draftState", function (state) {
				const s = state as ReturnType<DraftState["syncData"]>;
				if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
					const choice = Math.floor(Math.random() * s.booster.length);
					clientState.pickedCards.push(s.booster[choice]);
					clientState.state = s;
					clients[nonOwnerIdx].emit("pickCard", { pickedCards: [choice], burnedCards: [] }, ackNoError);
				}
			});
			clients[nonOwnerIdx].once("endDraft", function () {
				clients[nonOwnerIdx].removeListener("draftState");
				done();
			});

			const choice = Math.floor(Math.random() * clientState.state.booster.length);
			clientState.pickedCards.push(clientState.state.booster[choice]);
			clients[nonOwnerIdx].emit("pickCard", { pickedCards: [choice], burnedCards: [] }, ackNoError);
		});

		disconnect();
	});

	describe("With Disconnect and replacing by a bot.", function () {
		connect();
		startDraft();

		it("Non-owner disconnects, owner receives a warning.", function (done) {
			clients[ownerIdx].once("userDisconnected", () => {
				waitForSocket(clients[nonOwnerIdx], () => {
					clients.splice(nonOwnerIdx, 1);
					done();
				});
			});
			clients[nonOwnerIdx].disconnect();
			ownerIdx = 0;
		});

		it("Owner chooses to replace by bots.", function (done) {
			clients[ownerIdx].once("resumeOnReconnection", function () {
				done();
			});
			clients[ownerIdx].emit("replaceDisconnectedPlayers");
		});

		endDraft();
		expectCardCount(3 * latestSetCardPerBooster);
		disconnect();
	});

	describe("With Bots and all players disconnecting", function () {
		connect();
		it("Clients should receive the updated bot count.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(6);
				done();
			});
			clients[ownerIdx].emit("setBots", 6);
		});

		startDraft();

		it("Non-owner disconnects, Owner receives updated user infos.", function (done) {
			clients[ownerIdx].once("userDisconnected", function () {
				waitForSocket(clients[nonOwnerIdx], done);
			});
			clients[nonOwnerIdx].disconnect();
		});

		it("Owner disconnects.", function (done) {
			clients[ownerIdx].disconnect();
			waitForSocket(clients[ownerIdx], done);
		});

		it("Owner reconnects.", function (done) {
			clients[ownerIdx].on("connect", done);
			clients[ownerIdx].connect();
		});

		it("Non-owner reconnects, draft restarts.", function (done) {
			clients[ownerIdx].on("resumeOnReconnection", function () {
				done();
			});
			clients[nonOwnerIdx].connect();
		});

		endDraft();
		expectCardCount(3 * latestSetCardPerBooster);
		disconnect();
	});

	describe("With custom boosters and bots", function () {
		const CustomBoosters = ["xln", "rix", latestSetCardPerBooster === 14 ? "" : "dmu"];
		connect();
		it("Clients should receive the updated bot count.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(6);
				done();
			});
			clients[ownerIdx].emit("setBots", 6);
		});

		it("Clients should receive the updated booster spec.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.customBoosters).to.eql(CustomBoosters);
				done();
			});
			clients[ownerIdx].emit("setCustomBoosters", CustomBoosters);
		});

		for (const distributionMode of [
			"regular",
			"shufflePlayerBoosters",
			"shuffleBoosterPool",
		] as DistributionMode[]) {
			it(`Setting distributionMode to ${distributionMode}.`, function (done) {
				clients[nonOwnerIdx].once("sessionOptions", function (data) {
					expect(data.distributionMode).to.eql(distributionMode);
					done();
				});
				clients[ownerIdx].emit("setDistributionMode", distributionMode);
			});

			startDraft();
			let idx = 0;
			endDraft((b) => {
				if (distributionMode === "regular") {
					expect(
						b.every((c) => CustomBoosters[idx] === "" || c.set === CustomBoosters[idx]),
						"Boosters should be in specified order."
					);
					++idx;
				}
			});
			if (distributionMode !== "shuffleBoosterPool") expectCardCount(2 * 15 + 14);
		}
		disconnect();
	});

	describe("With random custom boosters and bots", function () {
		const CustomBoosters = ["random", "random", "random"];
		const Sets = ["afr", "mid", "one", "vow", "dmu", "snc", "iko", "thb", "eld", "m20", "war", "rna"];
		connect();
		it("Clients should receive the updated bot count.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(2);
				done();
			});
			clients[ownerIdx].emit("setBots", 2);
		});

		it("Clients should receive the updated booster spec.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.customBoosters).to.eql(CustomBoosters);
				done();
			});
			clients[ownerIdx].emit("setRestriction", Sets);
			clients[ownerIdx].emit("setCustomBoosters", CustomBoosters);
		});

		for (const distributionMode of [
			"regular",
			"shufflePlayerBoosters",
			"shuffleBoosterPool",
		] as DistributionMode[]) {
			const counts: Record<string, number> = {};
			it(`Setting distributionMode to ${distributionMode}.`, function (done) {
				clients[nonOwnerIdx].once("sessionOptions", function (data) {
					expect(data.distributionMode).to.eql(distributionMode);
					done();
				});
				clients[ownerIdx].emit("setDistributionMode", distributionMode);
			});

			startDraft();
			endDraft((b) => {
				if (!(b[0].set in counts)) counts[b[0].set] = 0;
				++counts[b[0].set];
			});
			it("should have one pack of each set.", function () {
				for (const [k, v] of Object.entries(counts)) {
					expect(Sets).to.include(k);
					expect(v, `${k}: ${v}`).to.equal(1);
				}
			});
		}
		disconnect();
	});

	describe("With shared random custom boosters and bots", function () {
		const CustomBoosters = ["randomShared", "randomShared", "randomShared"];
		const Sets = ["afr", "mid", "one", "vow", "dmu", "snc", "iko", "thb", "eld", "m20", "war", "rna"];
		connect();

		it("Clients should receive the updated booster spec.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.customBoosters).to.eql(CustomBoosters);
				done();
			});
			clients[ownerIdx].emit("setRestriction", Sets);
			clients[ownerIdx].emit("setCustomBoosters", CustomBoosters);
		});

		for (const distributionMode of [
			"regular",
			"shufflePlayerBoosters",
			"shuffleBoosterPool",
		] as DistributionMode[]) {
			const counts: Record<string, number> = {};
			it(`Setting distributionMode to ${distributionMode}.`, function (done) {
				clients[nonOwnerIdx].once("sessionOptions", function (data) {
					expect(data.distributionMode).to.eql(distributionMode);
					done();
				});
				clients[ownerIdx].emit("setDistributionMode", distributionMode);
			});

			startDraft();
			it("received boosters should be from setRestriction.", function () {
				for (const b of [
					clientStates[getUID(clients[ownerIdx])].state,
					clientStates[getUID(clients[nonOwnerIdx])].state,
				].map((s) => s.booster)) {
					expect(Sets).to.include(b[0].set);
					if (!(b[0].set in counts)) counts[b[0].set] = 0;
					++counts[b[0].set];
				}
			});
			endDraft((b) => {
				if (!(b[0].set in counts)) counts[b[0].set] = 0;
				++counts[b[0].set];
			});
			it("should have booster from three different sets.", function () {
				expect(Object.keys(counts).length).to.equal(3);
				for (const [k, v] of Object.entries(counts)) expect(v, `${k}: ${v}`).to.equal(2);
			});
		}
		disconnect();
	});

	describe("Using Arena Cube", function () {
		connect();
		it("Clients should receive the updated useCustomCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.useCustomCardList).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setUseCustomCardList", true);
		});
		it("Clients should receive the updated customCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function () {
				done();
			});
			clients[ownerIdx].emit("loadLocalCustomCardList", "Arena Historic Cube #1", ackNoError);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * 15);
		disconnect();
	});

	describe("Using cube with custom slots", function () {
		connect();
		it("Clients should receive the updated useCustomCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.useCustomCardList).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setUseCustomCardList", true);
		});
		it("Clients should receive the updated customCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function () {
				done();
			});
			clients[ownerIdx].emit("parseCustomCardList", CustomSlotsTestFile, ackNoError);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * 14);
		disconnect();
	});

	describe("Using cube with custom layouts", function () {
		connect();
		it("Clients should receive the updated useCustomCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.useCustomCardList).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setUseCustomCardList", true);
		});
		it("Clients should receive the updated customCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function () {
				done();
			});
			clients[ownerIdx].emit("parseCustomCardList", CustomLayoutsTestFile, ackNoError);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * 14);
		disconnect();
	});

	describe("Using cube with custom cards and no layout", function () {
		connect();
		it("Clients should receive the updated useCustomCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.useCustomCardList).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setUseCustomCardList", true);
		});
		it("Clients should receive the updated customCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function () {
				done();
			});
			clients[ownerIdx].emit("parseCustomCardList", CustomCards_NoLayout, ackNoError);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * 15);
		disconnect();
	});

	describe("Using cube with custom cards and default layout (sized slot)", function () {
		connect();
		it("Clients should receive the updated useCustomCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.useCustomCardList).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setUseCustomCardList", true);
		});
		it("Clients should receive the updated customCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function () {
				done();
			});
			clients[ownerIdx].emit("parseCustomCardList", CustomCards_SlotSize, ackNoError);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * 12);
		disconnect();
	});

	describe("With replacement", function () {
		connect();
		it("Clients should receive the updated useCustomCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.useCustomCardList).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setUseCustomCardList", true);
		});
		it("Clients should receive the updated CustomCardListWithReplacement.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.customCardListWithReplacement).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setCustomCardListWithReplacement", true);
		});
		it("Clients should receive the updated customCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function () {
				done();
			});
			clients[ownerIdx].emit("parseCustomCardList", WithReplacement, ackNoError);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * 15);
		disconnect();
	});

	describe("With replacement (Layout)", function () {
		connect();
		it("Clients should receive the updated useCustomCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.useCustomCardList).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setUseCustomCardList", true);
		});
		it("Clients should receive the updated CustomCardListWithReplacement.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.customCardListWithReplacement).to.equal(true);
				done();
			});
			clients[ownerIdx].emit("setCustomCardListWithReplacement", true);
		});
		it("Clients should receive the updated customCardList.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function () {
				done();
			});
			clients[ownerIdx].emit("parseCustomCardList", WithReplacementLayouts, ackNoError);
		});
		startDraft();
		endDraft();
		expectCardCount(3 * 10);
		disconnect();
	});

	describe("Custom card list with incorrect custom layouts should fail.", function () {
		connect();
		it("Mixed Layout Definitions.", function (done) {
			clients[ownerIdx].emit("parseCustomCardList", CustomLayouts_MixedLayoutDefinitionsTestFile, (response) => {
				expect(response.error).to.not.be.null;
				done();
			});
		});
		it("Multiple default slots definitions.", function (done) {
			clients[ownerIdx].emit("parseCustomCardList", CustomCards_MultipleDefaultSlots_Invalid, (response) => {
				expect(response.error).to.not.be.null;
				done();
			});
		});
		it("Too small without replacement.", function (done) {
			clients[ownerIdx].emit("parseCustomCardList", WithReplacement, (response) => {
				expect(response.error).to.not.be.null;
				done();
			});
		});
		it("Too small without replacement (layout).", function (done) {
			clients[ownerIdx].emit("parseCustomCardList", WithReplacementLayouts, (response) => {
				expect(response.error).to.not.be.null;
				done();
			});
		});
		disconnect();
	});

	describe("Using an observer and bots.", function () {
		connect();
		it("Clients should receive the updated ownerIsPlayer.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (val) {
				expect(val.ownerIsPlayer).to.equal(false);
				done();
			});
			clients[ownerIdx].emit("setOwnerIsPlayer", false);
		});
		it("Clients should receive the updated bot count.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(6);
				done();
			});
			clients[ownerIdx].emit("setBots", 6);
		});

		it("When session owner launches draft, players should receive a startDraft event", function (done) {
			let connectedClients = 0;
			let receivedBoosters = 0;
			for (let c = 0; c < clients.length; ++c) {
				if (c === ownerIdx) continue; // Owner doesn't play in this mode

				clients[c].once("startDraft", function () {
					connectedClients += 1;
					if (connectedClients === clients.length - 1 && receivedBoosters === clients.length - 1) done();
				});

				clients[c].once("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					expect(s.booster).to.exist;
					clientStates[getUID(clients[c])].state = s;
					receivedBoosters += 1;
					if (connectedClients === clients.length - 1 && receivedBoosters === clients.length - 1) done();
				});
			}
			clients[ownerIdx].emit("startDraft", ackNoError);
		});

		it("Pick until the draft ends.", function (done) {
			let draftEnded = 0;
			for (let c = 0; c < clients.length; ++c) {
				if (c === ownerIdx) continue; // Owner doesn't play in this mode

				const clientState = clientStates[getUID(clients[c])];
				clients[c].on("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
						clientState.state = s;
						clients[c].emit(
							"pickCard",
							{ pickedCards: [Math.floor(Math.random() * s.booster.length)], burnedCards: [] },
							ackNoError
						);
					}
				});
				clients[c].once("endDraft", function () {
					draftEnded += 1;
					clients[c].removeListener("draftState");
					if (draftEnded === clients.length - 1) {
						done();
					}
				});
			}
			for (let c = 0; c < clients.length; ++c) {
				if (c === ownerIdx) continue; // Owner doesn't play in this mode
				const clientState = clientStates[getUID(clients[c])];
				clients[c].emit(
					"pickCard",
					{ pickedCards: [Math.floor(Math.random() * clientState.state.booster.length)], burnedCards: [] },
					ackNoError
				);
			}
		});

		disconnect();
	});

	describe("Single Draft with Bots and burning", function () {
		const burnedCardsPerRound = 2;

		connect();
		it("Clients should receive the updated bot count.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(6);
				done();
			});
			clients[ownerIdx].emit("setBots", 6);
		});

		it("Clients should receive the updated burn count.", function (done) {
			clients[nonOwnerIdx].once("sessionOptions", function (sessionOptions) {
				expect(sessionOptions.burnedCardsPerRound).to.equal(burnedCardsPerRound);
				done();
			});
			clients[ownerIdx].emit("setBurnedCardsPerRound", burnedCardsPerRound);
		});

		it("When session owner launch draft, everyone should receive a startDraft event", function (done) {
			let connectedClients = 0;
			let receivedBoosters = 0;
			for (const c of clients) {
				const clientState = clientStates[getUID(c)];
				c.once("startDraft", function () {
					++connectedClients;
					if (connectedClients === clients.length && receivedBoosters === clients.length) done();
				});

				c.once("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					expect(s.booster).to.exist;
					clientState.state = s;
					clientState.pickedCards = [];
					++receivedBoosters;
					if (connectedClients === clients.length && receivedBoosters === clients.length) done();
				});
			}
			clients[ownerIdx].emit("startDraft", ackNoError);
		});

		it("Pick enough times, and the draft should end.", function (done) {
			this.timeout(20000);
			let draftEnded = 0;
			for (let c = 0; c < clients.length; ++c) {
				const clientState = clientStates[getUID(clients[c])];
				clients[c].on("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
						clientState.state = s;
						const burned = [];
						for (let cidx = 1; cidx < 1 + burnedCardsPerRound && cidx < s.booster.length; ++cidx)
							burned.push(cidx);
						clientState.pickedCards.push(clientState.state.booster[0]);
						clients[c].emit("pickCard", { pickedCards: [0], burnedCards: burned }, ackNoError);
					}
				});
				clients[c].once("endDraft", function () {
					draftEnded += 1;
					clients[c].removeListener("draftState");
					if (draftEnded === clients.length) done();
				});
			}
			for (let c = 0; c < clients.length; ++c) {
				const burned = [];
				const clientState = clientStates[getUID(clients[c])];
				for (let cidx = 1; cidx < 1 + burnedCardsPerRound && cidx < clientState.state.booster.length; ++cidx)
					burned.push(cidx);
				clientState.pickedCards.push(clientState.state.booster[0]);
				clients[c].emit("pickCard", { pickedCards: [0], burnedCards: burned }, ackNoError);
			}
		});
		expectCardCount(3 * Math.floor(15 / 3));
		disconnect();
	});

	describe("Draft mixing multiple picks and burning", function () {
		connect();
		it("Clients should receive the updated bot count.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(6);
				done();
			});
			clients[ownerIdx].emit("setBots", 6);
		});

		// Settings are not propagated to other clients when the values do not change
		let previousPickCount = 1;
		let previousBurnedCount = 0;
		for (let pickPerRound = 1; pickPerRound < 5; ++pickPerRound) {
			for (let burnPerRound = 0; burnPerRound < 5; ++burnPerRound) {
				it(`Clients should receive the updated pick count (${pickPerRound}).`, function (done) {
					if (previousPickCount !== pickPerRound) {
						clients[nonOwnerIdx].once("sessionOptions", function (sessionOptions) {
							expect(sessionOptions.pickedCardsPerRound).to.equal(pickPerRound);
							done();
						});
						clients[ownerIdx].emit("setPickedCardsPerRound", pickPerRound);
						previousPickCount = pickPerRound;
					} else done();
				});

				it(`Clients should receive the updated burn count (${burnPerRound}).`, function (done) {
					if (previousBurnedCount !== burnPerRound) {
						clients[nonOwnerIdx].once("sessionOptions", function (sessionOptions) {
							expect(sessionOptions.burnedCardsPerRound).to.equal(burnPerRound);
							done();
						});
						clients[ownerIdx].emit("setBurnedCardsPerRound", burnPerRound);
						previousBurnedCount = burnPerRound;
					} else done();
				});

				it("When session owner launch draft, everyone should receive a startDraft event", function (done) {
					let connectedClients = 0;
					let receivedBoosters = 0;
					for (const c of clients) {
						c.once("startDraft", function () {
							connectedClients += 1;
							if (connectedClients === clients.length && receivedBoosters === clients.length) done();
						});

						c.once("draftState", function (state) {
							const s = state as ReturnType<DraftState["syncData"]>;
							const clientState = clientStates[getUID(c)];
							expect(s.booster).to.exist;
							clientState.state = s;
							receivedBoosters += 1;
							if (connectedClients === clients.length && receivedBoosters === clients.length) done();
						});
					}
					clients[ownerIdx].emit("startDraft", ackNoError);
				});

				it("Pick enough times, and the draft should end.", function (done) {
					this.timeout(20000);
					let draftEnded = 0;
					for (let c = 0; c < clients.length; ++c) {
						const clientState = clientStates[getUID(clients[c])];
						clients[c].on("draftState", function (state) {
							const s = state as ReturnType<DraftState["syncData"]>;
							if (s.pickNumber !== clientState.state.pickNumber && s.boosterCount > 0) {
								expect(s.booster).to.exist;
								clientState.state = s;
								let cidx = 0;
								const picked = [];
								while (cidx < pickPerRound && cidx < s.booster.length) picked.push(cidx++);
								const burned = [];
								while (burned.length < burnPerRound && cidx < s.booster.length) burned.push(cidx++);
								clients[c].emit("pickCard", { pickedCards: picked, burnedCards: burned }, ackNoError);
							}
						});
						clients[c].once("endDraft", function () {
							draftEnded += 1;
							clients[c].removeListener("draftState");
							if (draftEnded === clients.length) done();
						});
					}
					for (let c = 0; c < clients.length; ++c) {
						const clientState = clientStates[getUID(clients[c])];
						let cidx = 0;
						const picked = [];
						while (cidx < pickPerRound && cidx < clientState.state.booster.length) picked.push(cidx++);
						const burned = [];
						while (burned.length < burnPerRound && cidx < clientState.state.booster.length)
							burned.push(cidx++);
						clients[c].emit("pickCard", { pickedCards: picked, burnedCards: burned }, ackNoError);
					}
				});
			}
		}
		disconnect();
	});

	describe("Pre-Determined Boosters", function () {
		connect();
		it("Receive error on invalid card list.", function (done) {
			clients[ownerIdx].emit("setBoosters", "Invalid Card!", (r) => {
				if (r.error) done();
			});
		});
		it("Receive error on invalid card list.", function (done) {
			clients[ownerIdx].emit("setBoosters", "Another\n\nInvalid Cards!\n", (r) => {
				if (r.error) done();
			});
		});

		it("Expect error on valid booster list but with wrong booster count.", function (done) {
			clients[ownerIdx].emit("setBoosters", "15 Forest\n\n15 Forest", (r) => {
				expect(r.code === 0);
				expect(!r.error);
				clients[ownerIdx].emit("startDraft", (response) => {
					expect(response.code !== 0);
					expect(response.error).to.exist;
					done();
				});
			});
		});

		it("Sumbit valid booster list", function (done) {
			clients[ownerIdx].emit(
				"setBoosters",
				"15 Forest\n\n15 Forest\n\n15 Forest\n\n15 Forest\n\n15 Forest\n\n15 Forest",
				(r) => {
					expect(r.code === 0);
					expect(!r.error);
					expect(Sessions[sessionID].usePredeterminedBoosters);
					done();
				}
			);
		});

		startDraft();
		endDraft();

		it(`Load cube with custom cards.`, (done) => {
			clients[ownerIdx].emit("parseCustomCardList", ValidCubes["Real_CustomCards_4"], (r) => {
				expect(r.code).to.equal(0);
				done();
			});
		});

		it("Submit valid booster list using cube's custom cards.", function (done) {
			clients[ownerIdx].emit(
				"setBoosters",
				fs.readFileSync(`./test/data/mtga_eggs_export_1_3_1_upload_packs.txt`, "utf8"),
				(r) => {
					expect(r.code === 0);
					expect(!r.error);
					expect(Sessions[sessionID].usePredeterminedBoosters);
					done();
				}
			);
		});

		startDraft();
		endDraft();

		it("Turn off usePredeterminedBoosters", function (done) {
			expect(Sessions[sessionID].usePredeterminedBoosters);
			clients[nonOwnerIdx].once("sessionOptions", function (sessionOptions) {
				expect(sessionOptions.usePredeterminedBoosters).to.be.false;
				expect(Sessions[sessionID].usePredeterminedBoosters).to.be.false;
				done();
			});
			clients[ownerIdx].emit("setUsePredeterminedBoosters", false);
		});

		startDraft();
		endDraft();

		disconnect();
	});

	// Explicitly tests mtgdraftbots since the external API calls are too slow for standard tests
	describe("With mtgdraftbots external API", function () {
		this.timeout(500000);
		connect();
		it("Clients should receive the updated bot count.", function (done) {
			ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
			nonOwnerIdx = 1 - ownerIdx;
			clients[nonOwnerIdx].once("sessionOptions", function (data) {
				expect(data.bots).to.equal(2);
				(global as any).FORCE_MTGDRAFTBOTS = true;
				done();
			});
			clients[ownerIdx].emit("setRestriction", ["one"]);
			clients[ownerIdx].emit("setBots", 2);
		});
		startDraft();
		endDraft();
		disconnect(() => {
			(global as any).FORCE_MTGDRAFTBOTS = false;
		});
	});
});

describe("Multiple Drafts", function () {
	const clients: {
		socket: Socket<ServerToClientEvents, ClientToServerEvents>;
		state: ReturnType<DraftState["syncData"]>;
		pickedCards: UniqueCard[];
	}[][] = [];
	const sessionIDs: SessionID[] = [];
	const sessionCount = 4;
	const playersPerSession = 8;

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	before(function (done) {
		disableLogs();
		expect(Object.keys(Connections).length).to.equal(0);
		for (let sess = 0; sess < sessionCount; ++sess) {
			sessionIDs[sess] = `Session ${sess}`;
			clients[sess] = [];
			for (let i = 0; i < playersPerSession; ++i) {
				clients[sess].push({
					socket: connectClient({
						sessionID: sessionIDs[sess],
						userName: `Client ${sess * playersPerSession + i}`,
					}),
					state: { booster: [], boosterCount: 0, boosterNumber: 0, pickNumber: 0, skipPick: false },
					pickedCards: [],
				});
			}
		}

		// Wait for all clients to be connected
		let connectedClients = 0;
		for (const s of clients) {
			for (const c of s) {
				c.socket.on("connect", function () {
					connectedClients += 1;
					if (connectedClients === playersPerSession * clients.length) {
						enableLogs(false);
						done();
					}
				});
			}
		}
	});

	after(function (done) {
		disableLogs();
		for (const s of clients)
			for (const c of s) {
				c.socket.disconnect();
			}

		waitForClientDisconnects(done);
	});

	it(`${sessionCount} sessions should be live.`, function (done) {
		expect(Object.keys(Sessions).length).to.equal(sessionCount);
		done();
	});

	it(`${playersPerSession * sessionCount} players should be connected.`, function (done) {
		expect(Object.keys(Connections).length).to.equal(playersPerSession * sessionCount);
		done();
	});

	it("When session owner launch draft, everyone in session should receive a startDraft event, and a unique booster", function (done) {
		let sessionsCorrectlyStartedDrafting = 0;
		const boosters: UniqueCard[][] = [];
		for (const [sessionIdx, sessionClients] of clients.entries()) {
			(() => {
				let connectedClients = 0;
				for (const c of sessionClients) {
					c.socket.on("startDraft", function () {
						connectedClients += 1;
						if (connectedClients === sessionClients.length) {
							sessionsCorrectlyStartedDrafting += 1;
						}
					});

					c.socket.once("draftState", function (state) {
						const s = state as ReturnType<DraftState["syncData"]>;
						(c as any).state = s;
						boosters.push(s.booster);
						if (
							sessionsCorrectlyStartedDrafting === sessionCount &&
							boosters.length === playersPerSession * sessionCount
						) {
							expect(boosters.length).to.equal(playersPerSession * sessionCount);
							for (const b of boosters) {
								checkColorBalance(b);
								checkDuplicates(b);
							}
							done();
						}
					});
				}
				const ownerIdx = sessionClients.findIndex(
					(c) => getUID(c.socket) === Sessions[sessionIDs[sessionIdx]].owner
				);
				sessionClients[ownerIdx].socket.emit("setColorBalance", true);
				sessionClients[ownerIdx].socket.emit("startDraft", ackNoError);
			})();
		}
	});

	it("New players should not be able to join once drafting has started", function (done) {
		const newClient = connectClient({
			sessionID: sessionIDs[0],
			userName: `New Client`,
		});

		newClient.on("setSession", function (newSessionID) {
			expect(newSessionID).to.not.equal(sessionIDs[0]);
			expect(Sessions[sessionIDs[0]].users.size).to.equal(playersPerSession);
			newClient.disconnect();
			waitForSocket(newClient, done);
		});
	});

	it("Do it enough times, and all the drafts should end.", function (done) {
		this.timeout(20000);
		let draftEnded = 0;
		for (let sess = 0; sess < clients.length; ++sess) {
			for (let c = 0; c < clients[sess].length; ++c) {
				clients[sess][c].socket.on("draftState", function (state) {
					const s = state as ReturnType<DraftState["syncData"]>;
					if (s.pickNumber !== clients[sess][c].state.pickNumber && s.boosterCount > 0) {
						clients[sess][c].state = s;
						clients[sess][c].socket.emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
					}
				});
				clients[sess][c].socket.once("endDraft", function () {
					draftEnded += 1;
					clients[sess][c].socket.removeListener("draftState");
					if (draftEnded === playersPerSession * sessionCount) done();
				});
			}
		}
		for (let sess = 0; sess < clients.length; ++sess) {
			for (let c = 0; c < clients[sess].length; ++c) {
				clients[sess][c].socket.emit("pickCard", { pickedCards: [0], burnedCards: [] }, ackNoError);
			}
		}
	});
});

describe("Sealed", function () {
	let clients: ReturnType<typeof makeClients> = [];
	const sessionID = "sessionID";
	const random = new Random(nodeCrypto);
	const boosterCount = random.integer(1, 10);

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	before(function (done) {
		const queries = [];
		for (let i = 0; i < 8; ++i)
			queries.push({
				sessionID: sessionID,
				userName: "DontCare",
			});
		clients = makeClients(queries, done);
	});

	after(function (done) {
		disableLogs();
		for (const c of clients) {
			c.disconnect();
		}

		waitForClientDisconnects(done);
	});

	it(`Owner launch a sealed (${boosterCount} boosters), clients should receive their card selection.`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		let receivedPools = 0;
		for (const client of clients)
			client.once("setCardSelection", (boosters) => {
				expect(boosters.length).to.equal(boosterCount);
				++receivedPools;
				if (receivedPools === clients.length) done();
			});
		clients[ownerIdx].emit("distributeSealed", boosterCount, Array(boosterCount).fill(""), ackNoError);
	});

	const CustomBoosters = ["m19", "m20", "m21"];

	it(`Clients should receive the updated booster spec. (${CustomBoosters})`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		clients[(ownerIdx + 1) % 2].once("sessionOptions", function (data) {
			expect(data.customBoosters).to.eql(CustomBoosters);
			done();
		});
		clients[ownerIdx].emit("setCustomBoosters", CustomBoosters);
	});

	it(`Clients should receive a card pool with the correct boosters.`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		let receivedPools = 0;
		for (const client of clients)
			client.once("setCardSelection", (boosters) => {
				expect(boosters.length).to.equal(boosterCount);
				for (let idx = 0; idx < boosters.length; ++idx)
					expect(boosters[idx].every((c) => c.set === CustomBoosters[idx]));
				++receivedPools;
				if (receivedPools === clients.length) done();
			});
		clients[ownerIdx].emit("distributeSealed", boosterCount, Array(boosterCount).fill(""), ackNoError);
	});
});

import JumpstartBoosters from "../src/data/JumpstartBoosters.json" assert { type: "json" };
import Jumpstart2022Boosters from "../src/data/Jumpstart2022Boosters.json" assert { type: "json" };
import { Card, CardColor, DeckList, UniqueCard } from "../src/CardTypes.js";
import { SessionID, UserID } from "../src/IDTypes.js";
import { SetCode } from "../src/Types.js";
import { DraftState } from "../src/DraftState.js";
import { ClientToServerEvents, ServerToClientEvents } from "../src/SocketType.js";
import { Socket } from "socket.io-client";
import { JHHBooster } from "../src/JumpstartHistoricHorizons.js";

describe("Jumpstart", function () {
	let clients: ReturnType<typeof makeClients> = [];
	const sessionID = "JumpStartSession";

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	before(function (done) {
		const queries = [];
		for (let i = 0; i < 8; ++i)
			queries.push({
				sessionID: sessionID,
				userName: "DontCare",
			});
		clients = makeClients(queries, done);
	});

	after(function (done) {
		disableLogs();
		for (const c of clients) {
			c.disconnect();
		}

		waitForClientDisconnects(done);
	});

	it("Each booster contains 20 valid cards", function (done) {
		for (const b of JumpstartBoosters) {
			expect(b.cards.length).to.equals(20);
			for (const c of b.cards) {
				expect(Cards.has(c)).to.be.true;
			}
		}
		done();
	});

	it(`Owner launches a Jumpstart game, clients should receive their card selection (2*20 cards).`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		let receivedPools = 0;
		for (const client of clients) {
			client.once("setCardSelection", function (boosters) {
				expect(boosters.length).to.equal(2);
				for (const b of boosters) expect(b.length).to.equal(20);
				++receivedPools;
				if (receivedPools === clients.length) done();
			});
		}
		clients[ownerIdx].emit("distributeJumpstart", "jmp", ackNoError);
	});
});

describe("Jumpstart 2022", function () {
	let clients: ReturnType<typeof makeClients> = [];
	const sessionID = "JumpStart 2022 Session";

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	before(function (done) {
		const queries = [];
		for (let i = 0; i < 8; ++i)
			queries.push({
				sessionID: sessionID,
				userName: "DontCare",
			});
		clients = makeClients(queries, done);
	});

	after(function (done) {
		disableLogs();
		for (const c of clients) {
			c.disconnect();
		}

		waitForClientDisconnects(done);
	});

	it("Each booster contains 20 valid cards", function (done) {
		for (const b of Jumpstart2022Boosters) {
			expect(b.cards.length).to.equals(20);
			for (const c of b.cards) {
				expect(Cards.has(c)).to.be.true;
			}
		}
		done();
	});

	it(`Owner launches a Jumpstart 2022 game, clients should receive their card selection (2*20 cards).`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		let receivedPools = 0;
		for (const client of clients) {
			client.once("setCardSelection", function (boosters) {
				expect(boosters.length).to.equal(2);
				for (const b of boosters) expect(b.length).to.equal(20);
				++receivedPools;
				if (receivedPools === clients.length) done();
			});
		}
		clients[ownerIdx].emit("distributeJumpstart", "j22", ackNoError);
	});
});

describe("Jumpstart: Historic Horizons", function () {
	let clients: ReturnType<typeof makeClients> = [];
	const sessionID = "JumpStartSession";
	const userData: {
		[id: string]: { packChoices: [JHHBooster[], JHHBooster[][]]; ack: (user: string, cards: string[]) => void };
	} = {};

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	before(function (done) {
		const queries = [];
		for (let i = 0; i < 8; ++i)
			queries.push({
				sessionID: sessionID,
				userName: "DontCare",
			});
		clients = makeClients(queries, done);
	});

	after(function (done) {
		disableLogs();
		for (const c of clients) {
			c.disconnect();
		}

		waitForClientDisconnects(done);
	});

	it(`Owner launches a Jumpstart game, clients should receive their pack selection.`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		let receivedPools = 0;
		for (const client of clients) {
			client.once("selectJumpstartPacks", function (choices, ack) {
				expect(choices.length).to.equal(2);
				expect(choices[0].length).to.equal(3);
				expect(choices[1].length).to.equal(3);
				for (let i = 0; i < 3; ++i) expect(choices[1][i].length).to.equal(3);
				userData[client.id] = { packChoices: choices, ack: ack };
				++receivedPools;
				if (receivedPools === clients.length) done();
			});
		}
		clients[ownerIdx].emit("distributeJumpstart", "j21", ackNoError);
	});

	it(`Clients make their choice and draft log updates accordingly.`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		clients[ownerIdx].on("draftLog", (log) => {
			if (Object.keys(log.users).filter((uid) => !!log.users[uid].cards).length === clients.length) {
				clients[ownerIdx].removeListener("draftLog");
				done();
			}
		});
		for (const client of clients) {
			const cards = userData[client.id].packChoices[0][0].cards.map((card) => card.id);
			cards.concat(userData[client.id].packChoices[1][0][1].cards.map((card) => card.id));
			userData[client.id].ack(getUID(client), cards);
		}
	});
});

describe("Jumpstart: Super Jump!", function () {
	let clients: ReturnType<typeof makeClients> = [];
	const sessionID = "JumpStartSession";
	const userData: {
		[id: string]: { packChoices: [JHHBooster[], JHHBooster[][]]; ack: (user: string, cards: string[]) => void };
	} = {};

	beforeEach(function (done) {
		disableLogs();
		done();
	});

	afterEach(function (done) {
		enableLogs(this.currentTest!.state === "failed");
		done();
	});

	before(function (done) {
		const queries = [];
		for (let i = 0; i < 8; ++i)
			queries.push({
				sessionID: sessionID,
				userName: "DontCare",
			});
		clients = makeClients(queries, done);
	});

	after(function (done) {
		disableLogs();
		for (const c of clients) {
			c.disconnect();
		}

		waitForClientDisconnects(done);
	});

	it(`Owner launches a Jumpstart game, clients should receive their pack selection.`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		let receivedPools = 0;
		for (const client of clients) {
			client.once("selectJumpstartPacks", (choices, ack) => {
				expect(choices.length).to.equal(2);
				expect(choices[0].length).to.equal(3);
				expect(choices[1].length).to.equal(3);
				for (let i = 0; i < 3; ++i) expect(choices[1][i].length).to.equal(3);
				userData[client.id] = { packChoices: choices, ack: ack };
				++receivedPools;
				if (receivedPools === clients.length) done();
			});
		}
		clients[ownerIdx].emit("distributeJumpstart", "super", ackNoError);
	});

	it(`Clients make their choice and draft log updates accordingly.`, function (done) {
		const ownerIdx = clients.findIndex((c) => getUID(c) === Sessions[sessionID].owner);
		clients[ownerIdx].on("draftLog", (log) => {
			if (Object.keys(log.users).filter((uid) => !!log.users[uid].cards).length === clients.length) {
				clients[ownerIdx].removeListener("draftLog");
				done();
			}
		});
		for (const client of clients) {
			const cards = userData[client.id].packChoices[0][0].cards.map((card) => card.id);
			cards.concat(userData[client.id].packChoices[1][0][1].cards.map((card) => card.id));
			userData[client.id].ack(getUID(client), cards);
		}
	});
});
