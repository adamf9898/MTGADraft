import { UniqueCard } from "./CardTypes.js";
import { IDraftState, TurnBased } from "./IDraftState.js";
import { UserID } from "./IDTypes";

export type RotisserieDraftStartOptions = {
	singleton?: { cardsPerPlayer: number; exactCardCount: boolean };
	standard?: { boostersPerPlayer: number };
};

export class RotisserieDraftCard extends UniqueCard {
	owner: UserID | null = null;
}

export class RotisserieDraftState extends IDraftState implements TurnBased {
	players: UserID[];
	cards: RotisserieDraftCard[];
	pickNumber = 0;

	cardsPerPlayer: number;

	constructor(players: UserID[], cards: UniqueCard[], cardsPerPlayer: number) {
		super("rotisserie");
		this.players = players;
		this.cards = cards.map((card) => {
			return { ...card, owner: null };
		});
		this.cardsPerPlayer = cardsPerPlayer;
	}

	syncData(userID: UserID) {
		return {
			cards: this.cards,
			pickNumber: this.pickNumber,
			currentPlayer: this.currentPlayer(),
		};
	}

	currentPlayer(): UserID {
		const idx = this.pickNumber % (2 * this.players.length);
		if (idx < this.players.length) return this.players[idx];
		return this.players[this.players.length - 1 - (idx - this.players.length)];
	}

	// Returns true when the last card has been picked
	advance(): boolean {
		++this.pickNumber;
		return this.pickNumber >= Math.min(this.players.length * this.cardsPerPlayer, this.cards.length);
	}
}

export function isRotisserieDraftState(obj: any): obj is RotisserieDraftState {
	return obj instanceof RotisserieDraftState;
}

export type RotisserieDraftSyncData = ReturnType<RotisserieDraftState["syncData"]>;
