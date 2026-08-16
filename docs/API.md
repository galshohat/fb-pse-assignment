# REST API

Base URL `http://localhost:3000`. No authentication: this service is the web
client's backend and is expected to sit behind one. Its writes are rate limited
because each one spends gas.

The API describes itself. Browse and try the endpoints at
[localhost:3000/docs](http://localhost:3000/docs), or fetch the OpenAPI 3.0
document from `/openapi.json` — it is generated from the same schemas the
routes validate against, so it cannot drift from what the service accepts.

Every response below is real output from a running service, against the live
contract on Sepolia.

---

## `GET /tasks`

Reads the whole list from the contract. Free, and does not change anything.

```bash
curl -s http://localhost:3000/tasks
```

```json
[
  { "id": 0, "description": "my first test task", "completed": true },
  { "id": 1, "description": "test task from service layer", "completed": false }
]
```

Ids are assigned on-chain and start at 0. The list is global: every client of
this contract writes to the same one, so expect entries you did not create.

---

## `POST /tasks`

Adds a task. Sends a transaction and returns only after the receipt confirms it.
Took 5.3 seconds in the run below; ten to twenty is normal.

```bash
curl -s -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"description":"documented in API.md"}'
```

`201 Created`

```json
{
  "status": "confirmed",
  "task": { "id": 30, "description": "documented in API.md", "completed": false },
  "transaction": {
    "hash": "0x522b5d715f579a8d61ace8c6db861e6caee5c698c01e8b0ea6e09a20a38cbef9",
    "explorerUrl": "https://sepolia.etherscan.io/tx/0x522b5d71…",
    "blockNumber": 11500587,
    "gasUsed": "77718"
  }
}
```

The id is decoded from the `TaskAdded` event in the receipt, so it is the id the
contract actually assigned rather than a guess from the list length.

| Field         | Rules                                         |
| ------------- | --------------------------------------------- |
| `description` | required, string, 1–500 characters after trim |

---

## `POST /tasks/:id/complete`

Marks a task completed. Same lifecycle, and the same confirmed-only contract.

```bash
curl -s -X POST http://localhost:3000/tasks/30/complete
```

`200 OK`

```json
{
  "status": "confirmed",
  "task": { "id": 30, "description": "documented in API.md", "completed": true },
  "transaction": {
    "hash": "0x70ad6eb865b16c3b5fabe034d3c8e5c16b5ccd8667b7d5fab81f8842cabeee65",
    "explorerUrl": "https://sepolia.etherscan.io/tx/0x70ad6eb8…",
    "blockNumber": 11500589,
    "gasUsed": "47358"
  }
}
```

Completing costs less gas than adding — it flips a boolean rather than storing a
string.

---

## `GET /health`

Liveness, plus what this instance is pointed at. Makes no RPC call, so a monitor
polling it cannot turn into traffic against the rate-limited public endpoints.

```json
{
  "status": "ok",
  "service": "api",
  "chain": {
    "name": "Sepolia",
    "id": 11155111,
    "contract": "0xdF52AD4b53a094B97cA4a056d7f51b82E3b795c8",
    "explorerUrl": "https://sepolia.etherscan.io/address/0xdF52AD4b…"
  }
}
```

The web client reads the contract address from here rather than being configured
with it separately, so the two cannot disagree about what is on screen.

---

## Failures

Every failure has the same shape:

```json
{ "error": { "code": "…", "message": "…", "details": { "…": "…" } } }
```

`code` is stable and machine-readable; `message` is written for a person;
`details` appears when there is something structured worth acting on.

| Status | Code                     | When                                                             |
| ------ | ------------------------ | ---------------------------------------------------------------- |
| 202    | —                        | Submitted but not confirmed in time. Not an error — see below.   |
| 400    | `VALIDATION_FAILED`      | Description empty, missing, too long, or a non-numeric id        |
| 400    | `MALFORMED_JSON`         | The body is not valid JSON                                       |
| 404    | `TASK_NOT_FOUND`         | No task with that id                                             |
| 404    | `ROUTE_NOT_FOUND`        | No such route                                                    |
| 409    | `TASK_ALREADY_COMPLETED` | Someone already completed it — a normal outcome on a shared list |
| 413    | `PAYLOAD_TOO_LARGE`      | Body over 16 kB                                                  |
| 422    | `TRANSACTION_REVERTED`   | The contract declined it                                         |
| 429    | `RATE_LIMITED`           | More than 10 writes in a minute from one client IP               |
| 500    | `INTERNAL_ERROR`         | A bug here. Nothing about internals is returned                  |
| 502    | `UNEXPECTED_CHAIN_ERROR` | The chain failed in a way we do not recognise                    |
| 503    | `CHAIN_UNAVAILABLE`      | Every RPC endpoint is unreachable. Sends `Retry-After: 5`        |

Real examples:

```console
$ curl -s -X POST localhost:3000/tasks -H 'Content-Type: application/json' -d '{"description":""}'
{"error":{"code":"VALIDATION_FAILED","message":"description must not be empty"}}          # 400

$ curl -s -X POST localhost:3000/tasks/9999/complete
{"error":{"code":"TASK_NOT_FOUND","message":"Task 9999 does not exist",
          "details":{"taskId":9999}}}                                                     # 404

$ curl -s -X POST localhost:3000/tasks/30/complete    # already completed
{"error":{"code":"TASK_ALREADY_COMPLETED","message":"Task 30 is already completed",
          "details":{"taskId":30}}}                                                       # 409
```

### 202 is not a failure

If the receipt does not arrive within `TX_TIMEOUT_MS` (120 s by default), the
transaction is still on the network and may still be mined. The response says so
and carries the hash, because that hash is the only way to find it afterwards:

```json
{
  "status": "pending",
  "message": "The transaction was submitted but has not confirmed yet. It may still be mined; track it with the hash below.",
  "transaction": { "hash": "0x…", "explorerUrl": "https://sepolia.etherscan.io/tx/0x…" }
}
```

A client must branch on `status`, not on the status code alone. Treating this as
an error loses the hash.

### Why a revert is 422

The request was well-formed and the service worked correctly; the contract
declined it. `500` would blame the wrong party, and it is what makes an
under-specified API look broken when it is behaving exactly as designed.

---

## Hardening

- **CORS** allows exactly one origin, from `CORS_ORIGIN`. Not a wildcard.
- **Writes are rate limited** to 10 per minute per client IP — the wallet is
  shared, and an unthrottled caller drains it. Reads are free and unlimited.
  Behind a proxy this keys on the forwarded client address, with exactly one
  hop trusted so the value cannot be spoofed by the caller.
- **Bodies are capped at 16 kB.** Descriptions are capped at 500 characters, so
  anything larger is not ours.
- **helmet** sets the standard security headers; the framework banner is off.
- **Descriptions are data, never markup.** Nothing interpolates them into HTML
  anywhere in this workspace.
