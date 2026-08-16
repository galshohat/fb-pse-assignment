---
name: mcp-auth
description: The MCP server's access-control model — roles, scopes, the two credential paths (OAuth 2.1 and API keys), how scope is enforced, and audit logging. Use when touching packages/mcp or documenting how the server is secured.
---

# MCP access control

The MCP server exposes tools that spend gas and write irreversibly to a public blockchain, so
every request is authenticated and every write is scope-checked.

## Scopes and roles

Two scopes: `tasks:read` (getTasks) and `tasks:write` (addTask, completeTask). Roles are named
bundles of scopes, not a separate concept:

| Role       | Scopes                                     |
| ---------- | ------------------------------------------ |
| `viewer`   | `tasks:read`                               |
| `operator` | `tasks:read`, `tasks:write`                |
| `admin`    | `tasks:read`, `tasks:write`, `tasks:admin` |

## Two credential paths, one verifier

Both paths resolve to the same `AuthInfo { clientId, scopes, expiresAt }`, which is the single
seam where authentication ends and authorization begins:

- **OAuth 2.1** — authorization code with PKCE, short-lived access tokens, rotating refresh
  tokens. The interactive path; what an MCP client such as Claude Code uses.
- **Scoped API keys** — long-lived bearer credentials for scripts, CI, and clients that cannot
  run a browser flow. Stored hashed, with an expiry per key.

Adding a third path (a real identity provider) means writing one more verifier, not touching
tool code. Keep it that way.

## Enforcement is two-layered

1. **Visibility.** The server is built per request from the caller's `AuthInfo`, so a
   `tasks:read` client never sees `addTask` or `completeTask` in `tools/list` at all. A tool
   that is not offered cannot be misused.
2. **Execution.** Each write handler re-checks its scope from `ctx.http.authInfo` anyway. The
   check must never be silent: return an error result naming the required scope and the scopes
   the caller actually has.

Layer 1 is ergonomics, layer 2 is the actual guarantee. Never remove layer 2 on the grounds
that layer 1 makes it unreachable.

## Confirmation before writing

Write tools ask the caller to confirm before sending a transaction. Elicitation is the
mechanism where the client supports it; where it does not, a `confirm` argument on the tool is
the fallback. Anything other than an explicit accept means do not execute — a declined,
cancelled, or absent confirmation are all refusals.

## Audit log

Every tool call is logged, whether it succeeded, was rejected, or failed: timestamp, client
ID, tool, arguments, scopes held, outcome, and transaction hash where one exists. Rejections
are the entries that matter most, so never log only the happy path. Never log a token, a key,
or the signing key.
