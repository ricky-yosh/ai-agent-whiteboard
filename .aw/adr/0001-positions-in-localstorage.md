# ADR 0001: Card Positions Stored in localStorage, Not in JSON

## Status

Accepted

## Context

The JSON file is the shared communication channel between the human (browser) and the AI (CLI). The AI edits JSON to communicate; keeping coordinates out of the JSON prevents the AI's context from being polluted with visual noise it cannot usefully reason about. However, the human needs a stable layout that survives reloads.

## Decision

Card (x, y) positions are stored in the browser's `localStorage`, keyed by card id. The JSON file never contains coordinates. On load, the browser applies stored positions to known card ids and auto-places new cards. On drag, the browser writes updated positions to `localStorage` only.

## Consequences

- AI JSON edits stay concise and readable — no coordinate churn.
- Layout is per-browser, per-device. Opening the file on a different machine starts with auto-layout.
- If a card id changes in the JSON, its stored position is orphaned (silent, harmless — new card gets auto-placed).
- Clearing browser storage resets all positions.
