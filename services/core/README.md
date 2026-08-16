# core

Everything this system knows about the blockchain lives here. `api` and `mcp`
are thin layers on top; neither talks to the chain directly.

**It is a library, not a service.** It has no port and no start command — it is
imported. That is deliberate: what the two services needed to share was the
logic, not another process to call over the network. Sharing it at compile time
means they cannot disagree about how a transaction is sent or what counts as
success.

## What's in it

| File              | What it does                                                                         |
| ----------------- | ------------------------------------------------------------------------------------ |
| `abi.ts`          | The contract's interface, typed, so a wrong function name fails to compile           |
| `config.ts`       | Reads and validates the environment. Missing settings fail at startup, not later     |
| `clients.ts`      | Connects to Sepolia across four public endpoints, falling to the next if one is down |
| `todo-service.ts` | The three operations, and the write sequence they all follow                         |
| `errors.ts`       | Typed failures, so nothing above ever sees a raw blockchain library error            |

## The one rule worth knowing

Every write does the same four things in the same order: **check it can
succeed, rehearse it, send it, wait for the receipt.**

The check is free and catches what we can already see is wrong — an empty
description, a task that doesn't exist. That matters because the network
charges for failed attempts too, so a request that was never going to work
should not reach it. The rehearsal catches what we couldn't see, like a task
someone else completed a moment ago. And nothing is reported as done until a
receipt confirms it: sending returns a tracking number immediately, but the
network can still reject the transaction afterwards.

Writes also take turns, one at a time. Every transaction from a wallet is
numbered in sequence, and two built simultaneously claim the same number — one
of them then gets discarded by the network. Queueing them keeps that from
happening.

## Testing

Unit tests against a fake blockchain client, so they run offline and for free.
Nothing here spends gas. To exercise the real chain, use `npm run smoke` from
the repository root — that one does cost testnet gas and says so.

```bash
npm test --workspace @todo/core
```

More detail in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).
