# Blockchain TODO List

A to-do list whose state lives on the Ethereum blockchain. A pre-deployed smart contract on
the Sepolia testnet stores the tasks; this workspace provides everything around it — a REST
API, an authenticated MCP server that lets AI assistants manage the list conversationally,
and a web client.

![The web client](docs/assets/web-list.png)

## Architecture

```
  Web client ─────────► REST API ──────┐
                                       ├──► core ──► Sepolia RPC ──► TodoList contract
  AI assistant ───────► MCP server ────┘            (with failover)
  (Claude Code)         OAuth 2.1 / API keys
```

Three services run independently; all blockchain logic lives in one shared `core` package so
the REST and MCP layers cannot drift apart. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Node.js 22.9 or newer, and a Sepolia wallet holding a little testnet ETH. No database, no
local chain, nothing else to install.

```bash
npm install
cp .env.example .env     # then set WALLET_PRIVATE_KEY
npm run verify           # typecheck, lint, tests
```

Run the services (each in its own terminal):

```bash
npm run dev:api          # REST API      → http://localhost:3000
npm run dev:mcp          # MCP server    → http://localhost:3001
npm run dev:web          # Web client    → http://localhost:5173
```

Or start all three as containers, on the same ports:

```bash
docker compose up --build
```

The API documents itself: browse and try the endpoints at
[localhost:3000/docs](http://localhost:3000/docs), or fetch the OpenAPI document from
`/openapi.json`.

To prove the whole path end to end against the live contract — this one spends testnet gas:

```bash
npm run smoke
```

## Connecting an AI assistant

The MCP server listens at `http://localhost:3001/mcp` and refuses anonymous callers. A
client opened in this directory discovers it through the checked-in `.mcp.json` and starts
the OAuth flow on its own; scripts and anything without a browser use a scoped API key
instead. Both paths, step by step, are in
[SETUP.md](docs/SETUP.md#connect-an-ai-assistant).

## What a write does

Adding or completing a task sends a real transaction, spends testnet gas, and cannot be
undone. Every interface treats that seriously in the same way: the write shows as pending
while the network works, and success is reported only once a receipt confirms it — a
transaction hash is not a result. If confirmation takes longer than the timeout, the hash is
returned rather than swallowed, so the transaction can still be tracked.

## Configuration

All services read the single `.env` file at the repository root. Only
`WALLET_PRIVATE_KEY` has no usable default — everything else works as shipped. `.env.example`
documents each variable, and [SETUP.md](docs/SETUP.md#configuration) has the full table.

## Client-facing documentation

| Document                                        | What it covers                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [SETUP.md](docs/SETUP.md)                       | **Setting up and running** the application, including the MCP server, and what to do when it misbehaves              |
| [API.md](docs/API.md)                           | **Using the REST API** — every endpoint with worked examples, and the full error catalogue                           |
| [MCP.md](docs/MCP.md)                           | **Using it from an AI assistant** — the tools, the access-control model, and the tradeoffs behind it                 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)         | **Maintaining it** — how the parts fit, why they were built that way, and the known gaps                             |
| [FOR-STAKEHOLDERS.md](docs/FOR-STAKEHOLDERS.md) | **For a non-technical reader** — what the assistant integration is for and what stands between it and spending money |
