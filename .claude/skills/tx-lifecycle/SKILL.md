---
name: tx-lifecycle
description: How this project sends blockchain transactions — the simulate/send/confirm sequence, serialization of concurrent writes, RPC failover, revert decoding and bigint handling. Use when touching packages/core or any code path that writes to the chain.
---

# Transaction lifecycle

The library is [viem](https://viem.sh). Every write follows the same four steps, in `core`,
and nowhere else.

## 1. Validate, 2. Simulate, 3. Send, 4. Confirm

```ts
// 1. Validate against known contract preconditions first — the cheapest rejection is the
//    one that never reaches the network. See the `contract` skill for the exact rules.

// 2. Simulate: runs the call against current state and reverts here instead of on-chain,
//    so a doomed transaction costs nothing. Returns a prepared request.
const { request } = await publicClient.simulateContract({
  address,
  abi,
  functionName: 'addTask',
  args: [description],
  account,
});

// 3. Send.
const hash = await walletClient.writeContract(request);

// 4. Confirm. A hash is not success; a receipt is.
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations, timeout });
if (receipt.status === 'reverted') throw new TransactionRevertedError(hash);
```

Simulation reads committed state, so it cannot rule out a race — always check the receipt
status too.

## Concurrent writes

One hot wallet signs every transaction. Two writes that read the same nonce produce a
`nonce too low` or `replacement transaction underpriced` failure, and under MCP plus REST
traffic that is a routine occurrence, not an edge case. Two defences, both in `core`:

- An in-process mutex serializes the entire simulate → send → confirm block, so within a
  process the wallet does one transaction at a time.
- viem's `nonceManager` on the account tracks nonces across sends as a second line of defence,
  including across processes where the mutex cannot help.

Never send a transaction outside the queue.

## RPC failover

Public Sepolia endpoints rate-limit and go down. The transport is
`fallback([http(url1), http(url2), ...])` over every configured URL, which retries and moves
to the next endpoint on failure. Treat a single endpoint's success as luck, not as the
expected case.

## Decoding reverts

Raw viem errors leak RPC internals and read like server faults. Walk the error to recover the
contract's own reason, then map it to a typed error from `core/src/errors.ts`:

```ts
const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
const reason = revert?.reason; // e.g. 'Task is already completed'
```

## Timeouts

If `waitForTransactionReceipt` times out, the transaction is still in flight — it is not
failed. Return the hash to the caller with an explicit "submitted, not yet confirmed" status
so nothing is lost.

## bigint at the boundary

`uint256` decodes to `bigint`, and `JSON.stringify` throws on bigint. Convert once, at the
edge of `core`, where a task ID becomes a `number` — task IDs are small and sequential, so
this is safe, but do it explicitly rather than relying on a global serializer patch.
