# Blockchain TODO List — working conventions

A REST API, an authenticated MCP server, and a web client around a pre-deployed `TodoList`
smart contract on Ethereum Sepolia. Writes cost real (testnet) gas and cannot be undone, so
correctness at the boundary matters more than feature breadth.

## Architecture invariant

All blockchain logic lives in `packages/core`. `packages/api` and `packages/mcp` are thin
transport layers that translate HTTP or MCP calls into `core` service calls and map
`core` errors onto their own error shapes. If a change adds contract knowledge, transaction
handling, or retry logic to `api` or `mcp`, it belongs in `core` instead.

Consequence: the two services never duplicate chain logic and cannot drift apart.

## Non-negotiables

- **Secrets.** The signing key is read from the environment only. Never write it to a file,
  a log line, an error message, or a test fixture. API keys are stored hashed.
- **Never spend gas on a call that cannot succeed.** Validate input, then simulate, then send.
- **Never report success before confirmation.** A transaction hash is not a result; a receipt
  with `status: 'success'` is.
- **Never lose a transaction hash.** If waiting for a receipt times out, return the hash so the
  caller can track it — do not swallow it in a generic error.

## Errors

`core` throws typed errors from `core/src/errors.ts`; transports map them to their own
vocabulary (HTTP status codes, MCP error results). Never let a raw viem error reach a client:
it leaks RPC internals and reads as a 500 when the real cause is a bad task ID.

## Testing

`core` is unit-tested against mocked viem clients. `api` and `mcp` are tested against a mocked
core service. Nothing in the automated test suite spends gas or touches the network; live
verification is a separate, explicit smoke script.

## Commits

Conventional commits, scoped by package (`feat(core):`, `fix(mcp):`). One reviewable unit per
commit. Before committing, the affected service must be verified working — not only unit tests
but the real thing: curl the endpoint, call the tool, load the page.

Never commit: `.env`, anything under `data/`, PDFs or DOCX files, build output.

## Documentation

`README.md` stays short and links out; depth belongs in `docs/`. Every command in the docs must
have been run verbatim before it is written down.
