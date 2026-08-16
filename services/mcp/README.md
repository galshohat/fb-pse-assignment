# mcp

Lets an AI assistant manage the to-do list by talking to it. MCP is the standard
that hands an assistant a set of tools; this server provides three of them and
decides who is allowed to use each.

```bash
npm run dev:mcp     # http://localhost:3001/mcp
```

## The three tools

| Tool           | Needs         | Does                                      |
| -------------- | ------------- | ----------------------------------------- |
| `getTasks`     | `tasks:read`  | Reads the list. Free                      |
| `addTask`      | `tasks:write` | Sends a transaction. Costs gas, permanent |
| `completeTask` | `tasks:write` | Sends a transaction. Costs gas, permanent |

## Why this needs authentication at all

The contract has no permissions of its own — anyone who knows its address can
write to it. So this server is not one safety net among several; it is the only
one. And what it guards is a wallet that spends real (testnet) money on
instructions from something that is not a person.

Two ways in, for two kinds of caller:

- **OAuth 2.1** for anything with a browser and a person. The client discovers
  the server from a `401`, opens a consent page, and the person picks whether it
  gets read-only or write access. Tokens last 15 minutes and refresh silently.
- **An API key** for scripts and CI, which have no browser to open. Issued by a
  local command, never over HTTP.

Both end up at the same function, `verifyAccessToken`, and past that point
nothing in the server knows which kind of credential arrived — same permissions,
same expiry, same audit trail.

## Before it spends anything

A write never happens on the first request. The server describes what it would
do and waits for an explicit second, confirming call — and where the assistant's
software supports it, that confirmation is a prompt shown to a person.

Every call is written to `data/audit.jsonl` whatever the outcome, including
refusals. The credential itself is never logged, only which one it was.

## Managing keys

```bash
npm run keys -w @todo/mcp -- issue --role operator --label "CI" --days 7
npm run keys -w @todo/mcp -- list
npm run keys -w @todo/mcp -- revoke <id>
```

A key is shown once, at issue; only its hash is stored. Revoking takes effect on
the very next call.

## Testing

Against a fake `core`, so no network and no gas.

```bash
npm test --workspace @todo/mcp
```

The full access-control model, and a real recorded session:
[docs/MCP.md](../../docs/MCP.md).
