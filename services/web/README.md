# web

The page people use: see the list, add a task, mark one done. React and Vite,
talking to [`api`](../api) over HTTP. It never touches the blockchain itself.

```bash
npm run dev:web     # http://localhost:5173
```

It needs the API running. The port is fixed at 5173, because the API allows
exactly one browser origin — starting on 5174 instead would turn "that port was
busy" into a confusing permissions error.

## The problem this interface actually has

A change here takes ten seconds or more, costs money, and cannot be undone. So
the design is built around making the state of a change unmistakable rather than
hiding the wait:

| State           | What you see                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Sending**     | The row appears immediately, marked pending, with no id yet — the contract assigns that — and a counter of how long it has been waiting |
| **Confirmed**   | The real row replaces it, and a message reports the block and the gas it cost, with a link to the public record                         |
| **Refused**     | A message saying what the contract objected to, in words rather than an error code                                                      |
| **Unconfirmed** | If it takes too long: the transaction is still out there, so the notice stays on screen with its tracking number rather than vanishing  |

Nothing is shown as done before the chain confirms it.

## How it's built

- **TanStack Query** holds the server state, so refreshing after a change is one
  cache invalidation rather than manual bookkeeping.
- **Tailwind, with named colours in one stylesheet** — components refer to
  `surface`, `line`, `ok`, `warn`, never to a specific colour. Restyling is one
  file.
- **Results are announced**, so a message reaches someone who looked away and a
  screen reader reads it out.
- Empty descriptions are refused in the browser, because a rejected transaction
  still costs gas.

## In a container

Built to static files and served by nginx — the dev server above is a
development tool, not something to run in production. Filenames of the built
files contain a hash of their contents, so they can be cached indefinitely while
`index.html` is never cached, which is what makes a new version appear
immediately.

## Testing

```bash
npm test --workspace @todo/web
```

Conventions are in [`.claude/skills/frontend-design`](../../.claude/skills/frontend-design/SKILL.md).
