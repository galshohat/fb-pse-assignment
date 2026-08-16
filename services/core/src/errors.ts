import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  WaitForTransactionReceiptTimeoutError,
} from 'viem';
import { CONTRACT_REVERTS } from './abi.js';

/**
 * Stable identifiers for the failure modes callers can act on. Transports map
 * these onto their own vocabulary — HTTP status codes, MCP error results — so
 * adding a code here means deciding how every transport should present it.
 */
export type TodoErrorCode =
  | 'VALIDATION_FAILED'
  | 'TASK_NOT_FOUND'
  | 'TASK_ALREADY_COMPLETED'
  | 'TRANSACTION_REVERTED'
  | 'TRANSACTION_TIMEOUT'
  | 'CHAIN_UNAVAILABLE'
  | 'UNEXPECTED_CHAIN_ERROR';

/**
 * Base class for every failure this package raises. A raw viem error reaching
 * a client is a defect: it leaks RPC internals and makes a bad task ID look
 * like a server fault.
 */
export abstract class TodoError extends Error {
  abstract readonly code: TodoErrorCode;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Input rejected before anything was sent to the chain. No gas was spent. */
export class ValidationError extends TodoError {
  readonly code = 'VALIDATION_FAILED';

  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export class TaskNotFoundError extends TodoError {
  readonly code = 'TASK_NOT_FOUND';

  constructor(readonly taskId: number) {
    super(`Task ${taskId} does not exist`);
  }
}

export class TaskAlreadyCompletedError extends TodoError {
  readonly code = 'TASK_ALREADY_COMPLETED';

  constructor(readonly taskId: number) {
    super(`Task ${taskId} is already completed`);
  }
}

/** The transaction was mined but the contract rejected it. Gas was spent. */
export class TransactionRevertedError extends TodoError {
  readonly code = 'TRANSACTION_REVERTED';

  constructor(
    readonly reason: string,
    readonly transactionHash?: `0x${string}`,
  ) {
    super(`Transaction reverted: ${reason}`);
  }
}

/**
 * The transaction was accepted by the network but its outcome is not known
 * here: either no receipt arrived within the budget, or the wait itself failed
 * — an RPC endpoint dropped, say. Both mean the same thing to a caller. It is
 * in flight, not failed, and the hash is carried so the transaction can still
 * be tracked rather than lost.
 *
 * `timeoutMs` is 0 when the wait ended for a reason other than the budget.
 */
export class TransactionTimeoutError extends TodoError {
  readonly code = 'TRANSACTION_TIMEOUT';

  constructor(
    readonly transactionHash: `0x${string}`,
    readonly timeoutMs: number,
  ) {
    super(
      timeoutMs > 0
        ? `Transaction ${transactionHash} was submitted but not confirmed within ${timeoutMs}ms; it may still be mined`
        : `Transaction ${transactionHash} was submitted but confirmation could not be checked; it may still be mined`,
    );
  }
}

/** Every configured RPC endpoint failed. Retrying later may succeed. */
export class ChainUnavailableError extends TodoError {
  readonly code = 'CHAIN_UNAVAILABLE';

  constructor(options?: { cause?: unknown }) {
    super('The blockchain network is currently unreachable', options);
  }
}

export class UnexpectedChainError extends TodoError {
  readonly code = 'UNEXPECTED_CHAIN_ERROR';

  constructor(options?: { cause?: unknown }) {
    super('An unexpected error occurred while talking to the blockchain', options);
  }
}

export function isTodoError(error: unknown): error is TodoError {
  return error instanceof TodoError;
}

/** Extra facts the mapper cannot recover from the error itself. */
export interface ChainErrorContext {
  /** Task the operation targeted, so a revert can name it. */
  readonly taskId?: number;
  /** Hash of the transaction, when one was broadcast before the failure. */
  readonly transactionHash?: `0x${string}`;
  /** Receipt wait budget, reported when that wait is what expired. */
  readonly timeoutMs?: number;
}

/**
 * Translates a viem failure into this package's vocabulary.
 *
 * Revert reasons are matched against the strings the contract actually emits
 * (see the ABI module) so that a caller learns "task 7 is already completed"
 * rather than an ABI-decoding trace.
 */
export function mapChainError(error: unknown, context: ChainErrorContext = {}): TodoError {
  if (isTodoError(error)) return error;

  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);

    if (revert instanceof ContractFunctionRevertedError) {
      return fromRevertReason(revert.reason, context);
    }

    if (error.walk((e) => e instanceof WaitForTransactionReceiptTimeoutError)) {
      // Only reachable once a transaction has been broadcast, so a hash is
      // expected here; without one there is nothing useful to report and the
      // failure is genuinely unexpected.
      return context.transactionHash
        ? new TransactionTimeoutError(context.transactionHash, context.timeoutMs ?? 0)
        : new UnexpectedChainError({ cause: error });
    }
  }

  /**
   * Past this point the error is not a revert, so if a hash exists the
   * transaction is on the network and its outcome is simply unknown to us —
   * the receipt wait died with it in flight, which public RPC endpoints cause
   * routinely by rate-limiting mid-poll.
   *
   * Reporting that as "the chain is unavailable, retry" would be two lies at
   * once: it drops the only handle on a live transaction, and it invites a
   * retry that spends gas a second time. Unconfirmed-with-a-hash is the honest
   * answer, and it is the one every transport already knows how to present.
   */
  if (context.transactionHash) {
    return new TransactionTimeoutError(context.transactionHash, 0);
  }

  if (
    error instanceof BaseError &&
    error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)
  ) {
    return new ChainUnavailableError({ cause: error });
  }

  return new UnexpectedChainError({ cause: error });
}

function fromRevertReason(reason: string | undefined, context: ChainErrorContext): TodoError {
  const taskId = context.taskId ?? -1;

  switch (reason) {
    case CONTRACT_REVERTS.taskNotFound:
      return new TaskNotFoundError(taskId);
    case CONTRACT_REVERTS.alreadyCompleted:
      return new TaskAlreadyCompletedError(taskId);
    case CONTRACT_REVERTS.emptyDescription:
      return new ValidationError('Task description cannot be empty', 'description');
    default:
      return new TransactionRevertedError(reason ?? 'unknown reason', context.transactionHash);
  }
}
