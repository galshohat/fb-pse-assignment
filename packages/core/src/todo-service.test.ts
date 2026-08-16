import {
  BaseError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeEventTopics,
  HttpRequestError,
  WaitForTransactionReceiptTimeoutError,
} from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todoListAbi, CONTRACT_REVERTS } from './abi.js';
import type { ChainClients } from './clients.js';
import type { CoreConfig } from './config.js';
import {
  ChainUnavailableError,
  TaskAlreadyCompletedError,
  TaskNotFoundError,
  TransactionRevertedError,
  TransactionTimeoutError,
  ValidationError,
} from './errors.js';
import { MAX_DESCRIPTION_LENGTH, TodoService } from './todo-service.js';

const CONTRACT_ADDRESS = '0xdF52AD4b53a094B97cA4a056d7f51b82E3b795c8' as const;
const TX_HASH = `0x${'ab'.repeat(32)}` as const;

const config: CoreConfig = {
  privateKey: `0x${'11'.repeat(32)}`,
  contractAddress: CONTRACT_ADDRESS,
  rpcUrls: ['https://rpc.example'],
  confirmations: 1,
  txTimeoutMs: 30_000,
};

/** A TaskAdded log the way the contract emits it: both parameters unindexed. */
function taskAddedLog(id: bigint, description: string) {
  return {
    address: CONTRACT_ADDRESS,
    topics: encodeEventTopics({ abi: todoListAbi, eventName: 'TaskAdded' }),
    data: encodeAbiParameters(
      [
        { name: 'id', type: 'uint256' },
        { name: 'description', type: 'string' },
      ],
      [id, description],
    ),
  };
}

function successReceipt(logs: unknown[] = []) {
  return {
    transactionHash: TX_HASH,
    status: 'success',
    blockNumber: 123n,
    gasUsed: 45_678n,
    logs,
  };
}

/** viem wraps contract reverts several layers deep; `walk` is what unwraps them. */
function revertError(reason: string): BaseError {
  const error = new BaseError('Execution reverted');
  const revert = new ContractFunctionRevertedError({
    abi: todoListAbi,
    functionName: 'completeTask',
    message: `reverted with reason string '${reason}'`,
  });
  // The public API exposes no constructor for a reason string, so set it here.
  Object.defineProperty(revert, 'reason', { value: reason });
  error.walk = ((fn?: (e: unknown) => boolean) =>
    fn ? (fn(revert) ? revert : null) : revert) as BaseError['walk'];
  return error;
}

function wrapError(inner: Error): BaseError {
  const error = new BaseError('Request failed');
  error.walk = ((fn?: (e: unknown) => boolean) =>
    fn ? (fn(inner) ? inner : null) : inner) as BaseError['walk'];
  return error;
}

function createService() {
  const publicClient = {
    readContract: vi.fn(),
    simulateContract: vi.fn().mockResolvedValue({ request: { mock: true } }),
    waitForTransactionReceipt: vi.fn().mockResolvedValue(successReceipt()),
  };
  const walletClient = { writeContract: vi.fn().mockResolvedValue(TX_HASH) };

  const clients = {
    account: { address: `0x${'22'.repeat(20)}` },
    publicClient,
    walletClient,
  } as unknown as ChainClients;

  return { service: new TodoService(clients, config), publicClient, walletClient };
}

describe('getTasks', () => {
  it('converts uint256 ids to numbers and preserves the contract ordering', async () => {
    const { service, publicClient } = createService();
    publicClient.readContract.mockResolvedValue([
      { id: 0n, description: 'first', completed: true },
      { id: 1n, description: 'second', completed: false },
    ]);

    await expect(service.getTasks()).resolves.toEqual([
      { id: 0, description: 'first', completed: true },
      { id: 1, description: 'second', completed: false },
    ]);
  });

  it('returns an empty list rather than failing when there are no tasks', async () => {
    const { service, publicClient } = createService();
    publicClient.readContract.mockResolvedValue([]);

    await expect(service.getTasks()).resolves.toEqual([]);
  });

  it('reports an unreachable network as a retryable error, not a generic failure', async () => {
    const { service, publicClient } = createService();
    publicClient.readContract.mockRejectedValue(
      wrapError(new HttpRequestError({ url: 'https://rpc.example' })),
    );

    await expect(service.getTasks()).rejects.toBeInstanceOf(ChainUnavailableError);
  });
});

describe('addTask validation', () => {
  const invalid: Array<[string, string]> = [
    ['an empty string', ''],
    ['only whitespace', '   \n\t '],
    ['more than the maximum length', 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1)],
  ];

  it.each(invalid)('rejects %s without sending a transaction', async (_label, description) => {
    const { service, publicClient, walletClient } = createService();

    await expect(service.addTask(description)).rejects.toBeInstanceOf(ValidationError);
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it('accepts a description of exactly the maximum length', async () => {
    const { service, publicClient } = createService();
    const description = 'x'.repeat(MAX_DESCRIPTION_LENGTH);
    publicClient.waitForTransactionReceipt.mockResolvedValue(
      successReceipt([taskAddedLog(7n, description)]),
    );

    await expect(service.addTask(description)).resolves.toMatchObject({ task: { id: 7 } });
  });

  it('trims surrounding whitespace before it reaches the chain', async () => {
    const { service, publicClient } = createService();
    publicClient.waitForTransactionReceipt.mockResolvedValue(
      successReceipt([taskAddedLog(3n, 'buy milk')]),
    );

    await service.addTask('  buy milk  ');

    expect(publicClient.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['buy milk'] }),
    );
  });
});

describe('addTask', () => {
  it('takes the new id from the emitted event rather than a follow-up read', async () => {
    const { service, publicClient } = createService();
    publicClient.waitForTransactionReceipt.mockResolvedValue(
      successReceipt([taskAddedLog(42n, 'ship it')]),
    );

    const result = await service.addTask('ship it');

    expect(result.task).toEqual({ id: 42, description: 'ship it', completed: false });
    expect(result.transaction).toEqual({
      hash: TX_HASH,
      explorerUrl: `https://sepolia.etherscan.io/tx/${TX_HASH}`,
      blockNumber: 123,
      gasUsed: '45678',
    });
    // The id came from the receipt, so no extra read was needed.
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it('fails loudly if a confirmed transaction carries no TaskAdded event', async () => {
    const { service } = createService();

    await expect(service.addTask('ship it')).rejects.toBeInstanceOf(TransactionRevertedError);
  });

  it('treats a mined but reverted transaction as a failure', async () => {
    const { service, publicClient } = createService();
    publicClient.waitForTransactionReceipt.mockResolvedValue({
      ...successReceipt(),
      status: 'reverted',
    });

    await expect(service.addTask('ship it')).rejects.toBeInstanceOf(TransactionRevertedError);
  });

  it('keeps the transaction hash when confirmation times out', async () => {
    const { service, publicClient } = createService();
    publicClient.waitForTransactionReceipt.mockRejectedValue(
      wrapError(new WaitForTransactionReceiptTimeoutError({ hash: TX_HASH })),
    );

    const error = await service.addTask('ship it').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TransactionTimeoutError);
    expect((error as TransactionTimeoutError).transactionHash).toBe(TX_HASH);
    expect((error as TransactionTimeoutError).timeoutMs).toBe(config.txTimeoutMs);
  });
});

describe('completeTask', () => {
  const existingTasks = [
    { id: 0n, description: 'done already', completed: true },
    { id: 1n, description: 'still open', completed: false },
  ];

  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['a negative id', -1],
    ['a fractional id', 1.5],
    ['a non-finite id', Number.NaN],
  ])('rejects %s before reading anything', async (_label, taskId) => {
    const { service, publicClient } = createService();

    await expect(service.completeTask(taskId)).rejects.toBeInstanceOf(ValidationError);
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it('treats id zero as a real task rather than a missing one', async () => {
    const { service, publicClient } = createService();
    publicClient.readContract.mockResolvedValue(existingTasks);

    // Task 0 exists and is already completed — the point is that it is not
    // reported as "not found" through a falsy-id mistake.
    await expect(service.completeTask(0)).rejects.toBeInstanceOf(TaskAlreadyCompletedError);
  });

  it('rejects an unknown id without spending gas', async () => {
    const { service, publicClient, walletClient } = createService();
    publicClient.readContract.mockResolvedValue(existingTasks);

    await expect(service.completeTask(99)).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it('completes an open task and reports the confirmed transaction', async () => {
    const { service, publicClient } = createService();
    publicClient.readContract.mockResolvedValue(existingTasks);

    const result = await service.completeTask(1);

    expect(result.task).toEqual({ id: 1, description: 'still open', completed: true });
    expect(result.transaction.hash).toBe(TX_HASH);
  });

  it('maps a contract revert back to the task it was about', async () => {
    const { service, publicClient } = createService();
    publicClient.readContract.mockResolvedValue(existingTasks);
    // Someone else completed the task between our check and our send.
    publicClient.simulateContract.mockRejectedValue(revertError(CONTRACT_REVERTS.alreadyCompleted));

    const error = await service.completeTask(1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TaskAlreadyCompletedError);
    expect((error as TaskAlreadyCompletedError).taskId).toBe(1);
  });
});

describe('write serialization', () => {
  it('runs concurrent writes one at a time so they cannot share a nonce', async () => {
    const { service, publicClient } = createService();

    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    publicClient.waitForTransactionReceipt.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return successReceipt([taskAddedLog(1n, 'x')]);
    });

    await Promise.all(
      ['a', 'b', 'c'].map(async (label) => {
        await service.addTask(label);
        order.push(label);
      }),
    );

    expect(maxInFlight).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledTimes(3);
  });

  it('releases the queue when a write fails, so later writes still run', async () => {
    const { service, publicClient } = createService();
    publicClient.waitForTransactionReceipt
      .mockRejectedValueOnce(wrapError(new HttpRequestError({ url: 'https://rpc.example' })))
      .mockResolvedValue(successReceipt([taskAddedLog(5n, 'second')]));

    await expect(service.addTask('first')).rejects.toBeInstanceOf(ChainUnavailableError);
    await expect(service.addTask('second')).resolves.toMatchObject({ task: { id: 5 } });
  });
});
