import { Mutex } from 'async-mutex';
import { parseEventLogs } from 'viem';
import type { TransactionReceipt } from 'viem';
import { todoListAbi } from './abi.js';
import { explorerTransactionUrl, type ChainClients } from './clients.js';
import type { CoreConfig } from './config.js';
import {
  mapChainError,
  TaskAlreadyCompletedError,
  TaskNotFoundError,
  TransactionRevertedError,
  ValidationError,
  type ChainErrorContext,
} from './errors.js';

/**
 * Upper bound on a task description. The contract itself imposes none, but the
 * caller pays gas proportional to the bytes stored, so an unbounded string is
 * an unbounded bill. This is a service policy, not a contract rule.
 */
export const MAX_DESCRIPTION_LENGTH = 500;

export interface Task {
  readonly id: number;
  readonly description: string;
  readonly completed: boolean;
}

/** What a confirmed write produced on-chain. */
export interface TransactionInfo {
  readonly hash: `0x${string}`;
  readonly explorerUrl: string;
  readonly blockNumber: number;
  readonly gasUsed: string;
}

export interface WriteResult {
  readonly task: Task;
  readonly transaction: TransactionInfo;
}

/**
 * Every interaction with the TodoList contract goes through this service.
 *
 * Writes follow the same sequence — validate, simulate, send, wait for the
 * receipt — and run one at a time. Serialization matters because one hot
 * wallet signs for every caller: two transactions built concurrently would
 * claim the same nonce, and the second would be rejected.
 *
 * Holding the lock through confirmation rather than releasing it after the
 * send costs throughput (a write takes as long as a block) but also prevents
 * two callers from paying gas to complete the same task, since each simulation
 * sees the previous transaction's effects.
 */
export class TodoService {
  private readonly writeQueue = new Mutex();

  constructor(
    private readonly clients: ChainClients,
    private readonly config: CoreConfig,
  ) {}

  /** Reads the full task list. Free: a view call spends no gas. */
  async getTasks(): Promise<Task[]> {
    try {
      const tasks = await this.clients.publicClient.readContract({
        address: this.config.contractAddress,
        abi: todoListAbi,
        functionName: 'getTasks',
      });

      return tasks.map((task) => ({
        id: toTaskId(task.id),
        description: task.description,
        completed: task.completed,
      }));
    } catch (error) {
      throw mapChainError(error);
    }
  }

  async addTask(description: string): Promise<WriteResult> {
    const validated = validateDescription(description);

    const receipt = await this.submit(async () => {
      const { request } = await this.clients.publicClient.simulateContract({
        address: this.config.contractAddress,
        abi: todoListAbi,
        functionName: 'addTask',
        args: [validated],
        account: this.clients.account,
      });

      return this.clients.walletClient.writeContract(request);
    }, {});

    // The contract does not return the new ID, and reading the task count back
    // would race with other callers. The TaskAdded event in our own receipt is
    // the authoritative answer.
    const [event] = parseEventLogs({
      abi: todoListAbi,
      eventName: 'TaskAdded',
      logs: receipt.logs,
    });

    if (!event) {
      throw new TransactionRevertedError(
        'transaction confirmed without emitting TaskAdded',
        receipt.transactionHash,
      );
    }

    return {
      task: { id: toTaskId(event.args.id), description: event.args.description, completed: false },
      transaction: describeTransaction(receipt),
    };
  }

  async completeTask(taskId: number): Promise<WriteResult> {
    validateTaskId(taskId);

    // Checking first turns the two predictable failures into free errors
    // instead of reverted transactions. It cannot make the write safe — the
    // list is shared and someone else may complete the task in between — so
    // the revert path below still has to work.
    const existing = await this.findTask(taskId);
    if (!existing) throw new TaskNotFoundError(taskId);
    if (existing.completed) throw new TaskAlreadyCompletedError(taskId);

    const receipt = await this.submit(
      async () => {
        const { request } = await this.clients.publicClient.simulateContract({
          address: this.config.contractAddress,
          abi: todoListAbi,
          functionName: 'completeTask',
          args: [BigInt(taskId)],
          account: this.clients.account,
        });

        return this.clients.walletClient.writeContract(request);
      },
      { taskId },
    );

    return {
      task: { ...existing, completed: true },
      transaction: describeTransaction(receipt),
    };
  }

  private async findTask(taskId: number): Promise<Task | undefined> {
    const tasks = await this.getTasks();
    return tasks.find((task) => task.id === taskId);
  }

  /**
   * Runs one write to completion while holding the wallet lock, and converts
   * anything that goes wrong into a typed error.
   */
  private async submit(
    send: () => Promise<`0x${string}`>,
    context: ChainErrorContext,
  ): Promise<TransactionReceipt> {
    return this.writeQueue.runExclusive(async () => {
      let hash: `0x${string}` | undefined;

      try {
        hash = await send();

        const receipt = await this.clients.publicClient.waitForTransactionReceipt({
          hash,
          confirmations: this.config.confirmations,
          timeout: this.config.txTimeoutMs,
        });

        // Simulation runs against committed state, so a transaction can still
        // be rejected by a state change that lands between simulating and
        // mining. A hash is not success; this is.
        if (receipt.status === 'reverted') {
          throw new TransactionRevertedError('execution reverted on-chain', hash);
        }

        return receipt;
      } catch (error) {
        throw mapChainError(error, {
          ...context,
          transactionHash: hash,
          timeoutMs: this.config.txTimeoutMs,
        });
      }
    });
  }
}

function describeTransaction(receipt: TransactionReceipt): TransactionInfo {
  return {
    hash: receipt.transactionHash,
    explorerUrl: explorerTransactionUrl(receipt.transactionHash),
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
  };
}

/**
 * Narrows a uint256 task ID to a number. IDs are assigned sequentially from
 * zero, so this is safe in practice — but the check is explicit rather than
 * assumed, because silently truncating an ID would corrupt every later lookup.
 */
function toTaskId(id: bigint): number {
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError(`Task ID ${id} exceeds the safe integer range`);
  }
  return Number(id);
}

function validateDescription(description: string): string {
  if (typeof description !== 'string') {
    throw new ValidationError('Task description must be a string', 'description');
  }

  const trimmed = description.trim();

  if (trimmed.length === 0) {
    throw new ValidationError('Task description cannot be empty', 'description');
  }

  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `Task description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`,
      'description',
    );
  }

  return trimmed;
}

function validateTaskId(taskId: number): void {
  if (!Number.isInteger(taskId) || taskId < 0) {
    throw new ValidationError('Task ID must be a non-negative integer', 'id');
  }
}
