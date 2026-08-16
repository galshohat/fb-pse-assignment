/**
 * Live verification against Ethereum Sepolia.
 *
 * Unlike the unit tests, this script talks to the real network and spends real
 * testnet gas: it adds a task and completes it. Run it after configuring .env
 * to confirm that the signing key, the RPC endpoints and the contract all work
 * together.
 *
 *   npm run smoke
 */
import { formatEther } from 'viem';
import {
  createChainClients,
  loadCoreConfig,
  TodoService,
  isTodoError,
  type Task,
} from '@todo/core';

const config = loadCoreConfig();
const clients = createChainClients(config);
const service = new TodoService(clients, config);

function heading(text: string): void {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`);
}

/** Runs an operation that is expected to fail, and reports how it failed. */
async function expectRejection(label: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    console.log(`  ${label}: NOT REJECTED — this is a bug`);
    process.exitCode = 1;
  } catch (error) {
    const known = isTodoError(error) ? error.code : 'UNTYPED ERROR';
    console.log(`  ${label}: ${known} — ${(error as Error).message}`);
    if (!isTodoError(error)) process.exitCode = 1;
  }
}

heading('Environment');
console.log('  signer:  ', clients.account.address);
console.log('  contract:', config.contractAddress);
console.log('  chain:   ', await clients.publicClient.getChainId());

const balance = await clients.publicClient.getBalance({ address: clients.account.address });
console.log('  balance: ', formatEther(balance), 'ETH');

if (balance === 0n) {
  console.error(
    '\nThe signing wallet has no funds; writes will fail. Fund it from a Sepolia faucet.',
  );
  process.exit(1);
}

heading('Read');
const before: Task[] = await service.getTasks();
console.log(`  ${before.length} tasks on-chain`);
console.log('  most recent:', before.at(-1));

heading('Rejected before spending gas');
await expectRejection('empty description  ', () => service.addTask('   '));
await expectRejection('oversized description', () => service.addTask('x'.repeat(501)));
await expectRejection('negative task id   ', () => service.completeTask(-1));
await expectRejection('fractional task id ', () => service.completeTask(1.5));
await expectRejection('unknown task id    ', () => service.completeTask(999_999));

heading('Add a task (real transaction)');
const added = await service.addTask(`smoke test ${new Date().toISOString()}`);
console.log('  task:', added.task);
console.log('  gas: ', added.transaction.gasUsed, 'in block', added.transaction.blockNumber);
console.log('  tx:  ', added.transaction.explorerUrl);

heading('Complete it (real transaction)');
const completed = await service.completeTask(added.task.id);
console.log('  task:', completed.task);
console.log(
  '  gas: ',
  completed.transaction.gasUsed,
  'in block',
  completed.transaction.blockNumber,
);
console.log('  tx:  ', completed.transaction.explorerUrl);

heading('Completing it again is rejected without a transaction');
await expectRejection('repeat completion  ', () => service.completeTask(added.task.id));

heading('Verify final state');
const after = await service.getTasks();
const ours = after.find((task) => task.id === added.task.id);
console.log(`  task count: ${before.length} -> ${after.length}`);
console.log('  our task:  ', ours);

if (!ours?.completed) {
  console.error('\nThe task we completed does not read back as completed.');
  process.exit(1);
}

console.log(`\nAll checks passed.${process.exitCode ? ' (with failures above)' : ''}`);
