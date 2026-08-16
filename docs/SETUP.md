# Setup

Everything here was run verbatim on a clean checkout before it was written down.

## Prerequisites

- **Node.js 20.10 or newer** (`node --version`). The services use
  `--env-file-if-exists`, which needs it.
- **A funded Sepolia wallet.** Writes spend testnet gas. A key with no balance
  reads fine and fails on the first write.
- Nothing else — no database, no Docker, no local chain.

## Install

```bash
npm install
cp .env.example .env
```

Then open `.env` and set `WALLET_PRIVATE_KEY`. It is the only variable without a
usable default; everything else works as shipped.

```bash
WALLET_PRIVATE_KEY=0x…   # a dedicated testnet key holding nothing of value
```

The key is read from the environment and nowhere else. It is never written to a
file, a log line, or an error message. `.env` is git-ignored — keep it that way.

Check the workspace before running anything:

```bash
npm run verify      # typecheck, lint, 124 tests. Touches no network
```

## Run the services

Each in its own terminal:

```bash
npm run dev:api     # REST API   → http://localhost:3000
npm run dev:mcp     # MCP server → http://localhost:3001
npm run dev:web     # Web client → http://localhost:5173
```

They are independent: any one runs without the others. The web client needs the
API; the MCP server does not.

Confirm the API is up and pointed where you expect:

```bash
curl -s http://localhost:3000/health
```

```json
{
  "status": "ok",
  "service": "api",
  "chain": {
    "name": "Sepolia",
    "id": 11155111,
    "contract": "0xdF52AD4b53a094B97cA4a056d7f51b82E3b795c8",
    "explorerUrl": "…"
  }
}
```

The API also documents itself at
[localhost:3000/docs](http://localhost:3000/docs).

> The web client's port is fixed. The API allows exactly one browser origin, so
> starting on 5174 instead would turn a busy port into a confusing CORS error.
> If 5173 is taken, free it rather than changing the port.

## Prove it end to end

This spends real testnet gas — it adds a task, completes it, and checks the
contract's refusals along the way:

```bash
npm run smoke
```

```text
Complete it (real transaction)
  task: { id: 31, description: 'smoke test 2026-08-16T10:34:58.630Z', completed: true }
  gas:  47358 in block 11500603
  tx:   https://sepolia.etherscan.io/tx/0xce5ac0d5…

Completing it again is rejected without a transaction
  repeat completion  : TASK_ALREADY_COMPLETED — Task 31 is already completed

All checks passed.
```

Nothing in `npm test` does this. The test suite must run offline, on a machine
with no funded wallet, for free.

## Connect an AI assistant

The MCP server refuses anonymous callers, so a client needs a credential. There
are two ways to give it one.

### OAuth, the automatic way

The repository ships a `.mcp.json`, so a client opened in this directory finds
the server on its own:

```json
{
  "mcpServers": {
    "blockchain-todo": { "type": "http", "url": "http://localhost:3001/mcp" }
  }
}
```

To register it somewhere else, or to re-create that file:

```bash
claude mcp add --transport http blockchain-todo http://localhost:3001/mcp --scope project
```

With the MCP server running:

```bash
claude mcp list
```

```text
blockchain-todo: http://localhost:3001/mcp (HTTP) - ! Needs authentication
```

That is the flow working, not failing. The server answered with a `401` and a
pointer to its metadata; the client read it and knows it must authenticate.
Running `/mcp` inside Claude Code opens the browser, where you approve the
connection and choose a role — **viewer** to look, **operator** to spend gas.
The token that comes back lasts 15 minutes and is refreshed silently.

### An API key, for anything without a browser

Scripts, CI, and clients that cannot do a browser flow:

```bash
npm run keys -w @todo/mcp -- issue --role operator --label "Claude Code" --days 7
```

```text
Issued an operator key.

  id       d23b87ab
  scopes   tasks:read, tasks:write
  expires  2026-08-23T10:35:59.566Z

  todo_key_«43 random characters, printed here and nowhere else»

This is the only time the key is shown. Store it somewhere safe; only its hash
is kept on disk.
```

Put it in the environment and let the config expand it, rather than writing the
key into a file:

```bash
export TODO_MCP_KEY=todo_key_…
```

```json
{
  "mcpServers": {
    "blockchain-todo": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": { "Authorization": "Bearer ${TODO_MCP_KEY}" }
    }
  }
}
```

Managing keys:

```bash
npm run keys -w @todo/mcp -- list
npm run keys -w @todo/mcp -- revoke d23b87ab
```

Revocation takes effect on the next call — the server notices the credential
file changed and reloads it, without a restart.

## Configuration

One `.env` at the repository root, read by every service.

| Variable                | Default                  | Notes                                                                 |
| ----------------------- | ------------------------ | --------------------------------------------------------------------- |
| `WALLET_PRIVATE_KEY`    | —                        | **Required.** Testnet key that signs                                  |
| `RPC_URLS`              | four public Sepolia RPCs | Comma-separated, tried in order                                       |
| `CONTRACT_ADDRESS`      | the deployed TodoList    | Any compatible contract                                               |
| `TX_CONFIRMATIONS`      | `1`                      | Blocks to wait for                                                    |
| `TX_TIMEOUT_MS`         | `120000`                 | After this, a write returns 202 with its hash                         |
| `API_PORT`              | `3000`                   |                                                                       |
| `CORS_ORIGIN`           | `http://localhost:5173`  | One origin, never a wildcard                                          |
| `MCP_PORT`              | `3001`                   |                                                                       |
| `MCP_PUBLIC_URL`        | `http://localhost:3001`  | Must match how clients reach it — it is the OAuth resource identifier |
| `MCP_DATA_DIR`          | `./data`                 | Hashed keys, OAuth state, audit log                                   |
| `MCP_ACCESS_TOKEN_TTL`  | `900`                    | Seconds                                                               |
| `MCP_REFRESH_TOKEN_TTL` | `86400`                  | Seconds                                                               |
| `VITE_API_URL`          | `http://localhost:3000`  | The API as the browser sees it                                        |

## When something is wrong

**`Missing required configuration: WALLET_PRIVATE_KEY`** — `.env` is missing or
the key is unset. The error names variables and never their values; one of them
is a private key.

**Writes fail with insufficient funds** — the wallet has no Sepolia ETH. Any
Sepolia faucet will do.

**Writes are slow, or a write returns `202`** — the network is busy or the
public RPCs are throttling. A `202` means the transaction is out there and
unconfirmed; the hash in the response is how you track it. Raise
`TX_TIMEOUT_MS` if it happens often.

**The web client says "Cannot reach the API"** — the API is not running, or
`VITE_API_URL` points somewhere else. The message includes the URL it tried.

**The browser console shows a CORS error** — the client is not on the origin in
`CORS_ORIGIN`.

**`claude mcp list` says "Needs authentication"** — expected before you
authenticate. Run `/mcp` in Claude Code, or use an API key.

**MCP calls return `401` with a key that used to work** — it expired or was
revoked. `npm run keys -w @todo/mcp -- list` shows the status of each.

**Registering a client returns `429`** — dynamic client registration is limited
to 20 an hour by the SDK, which is easy to exhaust while testing the flow
repeatedly. Wait out the window, or use an API key in the meantime; restarting
the server does not reset it, since the limiter counts per process uptime.

## Layout

```
packages/core   Blockchain logic: contract client, transaction lifecycle, errors
packages/api    REST API over core
packages/mcp    MCP server over core, with OAuth 2.1 and scoped API keys
packages/web    React web client
scripts/        smoke.ts — the live end-to-end check
docs/           This documentation
data/           Runtime state: hashed credentials, audit log. Git-ignored
```
