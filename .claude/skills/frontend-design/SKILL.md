---
name: frontend-design
description: Design and interaction conventions for the web client — visual language, the transaction feedback states, data fetching patterns and accessibility rules. Use when building or changing anything in packages/web.
---

# Web client design

The interface fronts an irreversible, slow, occasionally failing system. Its main job is
making the state of a transaction obvious at all times; looking good is how it earns trust
while doing that.

## Visual language

Tailwind, driven by semantic tokens defined once in the stylesheet rather than colour literals
scattered across components. The client is light only: `:root` declares `color-scheme: light`
and defines every colour once. Keep naming components against the semantic tokens anyway — it
is what makes the palette a single-file change.

- Type scale and spacing come from Tailwind's default scale; do not invent one-off values.
- Colour carries meaning: neutral for pending work, a single accent for actions, green for
  confirmed, amber for in-flight, red for failure. Never rely on colour alone — pair it with
  an icon or text label.
- Motion is short (150–200ms) and only marks state changes: a task completing, a toast
  arriving. No decorative animation.

## Transaction feedback is the core interaction

Every write passes through the same four states, and the UI must distinguish all four:

| State     | What the user sees                                                                           |
| --------- | -------------------------------------------------------------------------------------------- |
| Idle      | The action is available.                                                                     |
| Pending   | Optimistic row or disabled button with a spinner, plus the explorer link once a hash exists. |
| Confirmed | The task appears or flips to completed; a brief success toast.                               |
| Failed    | The optimistic state rolls back and a toast explains _why_ in plain language.                |

A pending write takes ten seconds or more. Never leave a button looking clickable while its
transaction is in flight, and never show a spinner without saying what it is waiting for.

## Data fetching

TanStack Query owns server state. Queries refetch on window focus and poll while a write is in
flight; mutations invalidate the task list on settle. Do not mirror server data into
`useState` — derive it.

## States that must be designed, not defaulted

Empty list, first load (skeletons, not a spinner on a blank page), backend unreachable, and a
write rejected by the contract. Each needs its own copy explaining what happened and what to
do next.

## Accessibility

Labelled controls, visible focus rings, transaction status in an `aria-live` region so it is
announced, and full keyboard operation of adding and completing tasks. Buttons that trigger
transactions carry an accessible name that says what will happen, not just "Complete".
