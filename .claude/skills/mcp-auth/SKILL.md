---
name: mcp-auth
description: The MCP server's access-control model — roles, scopes, the two credential paths (OAuth 2.1 and API keys), how scope is enforced, and audit logging. Use when touching services/mcp or documenting how the server is secured.
---

# MCP access control

The MCP server exposes tools that spend gas and write irreversibly to a public blockchain, so
every request is authenticated and every write is scope-checked.

## Scopes and roles

Two scopes: `tasks:read` (getTasks) and `tasks:write` (addTask, completeTask). Roles are named
bundles of scopes, not a separate concept:

| Role       | Scopes                      |
| ---------- | --------------------------- |
| `viewer`   | `tasks:read`                |
| `operator` | `tasks:read`, `tasks:write` |

Add a role only when a tool enforces a scope it grants. A role that resolves to no enforced
scope tells a caller they have a capability the server will not honour.

## Two credential paths, one verifier

Both paths resolve to the same `AuthInfo { clientId, scopes, expiresAt }`, which is the single
seam where authentication ends and authorization begins:

- **OAuth 2.1** — authorization code with PKCE, short-lived access tokens, rotating refresh
  tokens. The interactive path; what an MCP client such as Claude Code uses.
- **Scoped API keys** — long-lived bearer credentials for scripts, CI, and clients that cannot
  run a browser flow. Stored hashed, with an expiry per key.

Adding a third path (a real identity provider) means writing one more verifier, not touching
tool code. Keep it that way.

## Enforcement happens in the handler

The server is built per request from the caller's `AuthInfo`, but every tool is offered to
every authenticated caller. The scope check inside the handler is the gate, and it must name
the scope required and the scopes actually held.

Hiding write tools from read-only credentials was tried and rejected. An unregistered tool
answers `Tool addTask not found`, which reads as "the server is broken" rather than "your
credential is not sufficient" — the opposite of refusing clearly. What a read-only caller gets
instead is a warning in the tool description, so a model can tell before calling.

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
