# Blockchain TODO List

A to-do list whose state lives on the Ethereum blockchain. A pre-deployed smart contract on
the Sepolia testnet stores the tasks; this workspace provides everything around it — a REST
API, an authenticated MCP server that lets AI assistants manage the list conversationally,
and a web client.

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

## Configuration

All services read the single `.env` file at the repository root. `.env.example` documents
every variable; only `WALLET_PRIVATE_KEY` has no usable default.

| Variable             | Required | Default           | Purpose                             |
| -------------------- | -------- | ----------------- | ----------------------------------- |
| `WALLET_PRIVATE_KEY` | yes      | —                 | Testnet key that signs transactions |
| `RPC_URLS`           | no       | four public RPCs  | Sepolia endpoints, tried in order   |
| `CONTRACT_ADDRESS`   | no       | deployed TodoList | Contract the services talk to       |
| `API_PORT`           | no       | `3000`            | REST API port                       |
| `MCP_PORT`           | no       | `3001`            | MCP server port                     |

## Documentation

| Document                                        | Audience                                      |
| ----------------------------------------------- | --------------------------------------------- |
| [SETUP.md](docs/SETUP.md)                       | Setting up and running everything             |
| [API.md](docs/API.md)                           | REST endpoint reference                       |
| [MCP.md](docs/MCP.md)                           | MCP tools, authentication, access control     |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)         | How it works and why it is built this way     |
| [FOR-STAKEHOLDERS.md](docs/FOR-STAKEHOLDERS.md) | Plain-language overview, no blockchain needed |

## Layout

```
packages/core   Blockchain logic: contract client, transaction lifecycle, errors
packages/api    REST API over core
packages/mcp    MCP server over core, with OAuth 2.1 and scoped API keys
packages/web    React web client
```

## License

MIT
