/**
 * The wire format of the REST API, as published at `/openapi.json`.
 *
 * These are written out rather than imported from the server packages on
 * purpose: the client is a separate deployable that knows the HTTP contract and
 * nothing else. Importing the server's types would couple a browser bundle to
 * server internals and quietly make the contract untestable — the two would
 * always agree because they were the same file.
 */

export interface Task {
  readonly id: number;
  readonly description: string;
  readonly completed: boolean;
}

export interface TransactionInfo {
  readonly hash: string;
  readonly explorerUrl: string;
  readonly blockNumber: number;
  readonly gasUsed: string;
}

/** A write that was mined: the receipt was seen before the response was sent. */
export interface ConfirmedWrite {
  readonly status: 'confirmed';
  readonly task: Task;
  readonly transaction: TransactionInfo;
}

/**
 * A write the network accepted but that did not confirm in time (HTTP 202).
 * It may still be mined, so the hash is the important part of this payload.
 */
export interface PendingWrite {
  readonly status: 'pending';
  readonly message: string;
  readonly transaction: { readonly hash: string; readonly explorerUrl: string };
}

export type WriteOutcome = ConfirmedWrite | PendingWrite;

/** What the service is pointed at, reported by `/health`. */
export interface ChainContext {
  readonly name: string;
  readonly id: number;
  readonly contract: string;
  readonly explorerUrl: string;
}

export interface Health {
  readonly status: 'ok';
  readonly service: 'api';
  readonly chain: ChainContext;
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: { readonly field?: string; readonly taskId?: number };
  };
}
