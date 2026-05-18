export interface ActiveTurn {
  inputSeq: number;
  turnId: string;
}

export type TurnOutcome = "done" | "error" | "aborted";

/**
 * Host-local turn tracker for one supervisor process.
 *
 * The durable SOT is events.jsonl. This object only remembers the input
 * message seq long enough for the inbox watcher and stdout pump to emit
 * matching `turn_started` / `turn_finished` events.
 */
export class TurnTracker {
  #turns: ActiveTurn[] = [];

  begin(inputSeq: number): ActiveTurn {
    const turn: ActiveTurn = {
      inputSeq,
      turnId: `msg:${inputSeq}`,
    };
    this.#turns.push(turn);
    return turn;
  }

  finish(): ActiveTurn | undefined {
    return this.#turns.pop();
  }

  abortCurrent(): ActiveTurn | undefined {
    return this.#turns.pop();
  }

  current(): ActiveTurn | undefined {
    return this.#turns.at(-1);
  }
}
