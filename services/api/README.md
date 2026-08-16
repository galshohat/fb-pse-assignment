# api

The REST API the web client talks to. Three endpoints over the to-do list, and
nothing else — all the blockchain work happens in [`core`](../core).

```bash
npm run dev:api     # http://localhost:3000
```

## Endpoints

| Method | Path                  | Does                                        |
| ------ | --------------------- | ------------------------------------------- |
| `GET`  | `/tasks`              | The whole list. Free, changes nothing       |
| `POST` | `/tasks`              | Adds one. Costs gas                         |
| `POST` | `/tasks/:id/complete` | Marks one done. Costs gas                   |
| `GET`  | `/health`             | Whether it's up, and which contract it uses |
| `GET`  | `/docs`               | The API described, in a page you can try    |

Writes return **only after the transaction is confirmed** — not when it is sent.
A hash on its own means "submitted", and the network can still reject it, so
reporting that as success would be a lie a fair share of the time.

## Two things that surprise people

**A rejected task is a `422`, not a `500`.** The request was fine and the
service did its job; the contract declined it. A `500` would blame the wrong
side and make a working system look broken.

**A `202` is not an error.** It means the transaction was sent but hasn't
confirmed yet, and the response carries the hash so you can still track it.
Treating it as a failure throws away the only handle on a transaction that may
well succeed a minute later.

## What guards it

There is **no authentication** here, on purpose: this is the web client's
backend and is expected to sit behind whatever sign-in the surrounding system
already has. What protects it instead is a single allowed browser origin, a cap
of ten writes a minute so nothing can drain the wallet, standard security
headers, and a 16 kB limit on request bodies.

## Testing

Against a fake `core`, so no network and no gas.

```bash
npm test --workspace @todo/api
```

Full reference with real request and response examples:
[docs/API.md](../../docs/API.md).
