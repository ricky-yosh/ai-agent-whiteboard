# Context

## Domain Language

| Term | Definition | Avoid |
| --- | --- | --- |
| **Whiteboard** | A browser-based canvas that visualizes a shared JSON file containing cards and connections. | App, editor |
| **Card** | A node on the canvas with an id and text content, no coordinates stored in JSON. | Node, block |
| **Connection** | A directed link between two cards, referenced by card ids. Arrow points from `from` to `to`. | Edge, link |
| **JSON file** | The single source of truth shared between the human (browser) and the AI (CLI). | State, database |
| **Import** | Human pastes or loads the JSON into the AI CLI conversation so the AI can read the current whiteboard state. | Upload |
| **Export** | Human saves the AI's JSON output back to the file so the browser re-renders it. | Download |

## Relationships

- The **Whiteboard** renders whatever is in the **JSON file**.
- The **AI** communicates by editing the **JSON file** (via CLI conversation).
- The **human** communicates by creating/moving **cards** and **connections** in the browser, then **importing** the JSON to the AI.
- Coordinates are NOT in the JSON — the browser assigns layout automatically.

## Decisions

- No AI API integration in the app itself; AI interaction is out-of-band via CLI.
- Tech stack: HTML, CSS, JavaScript, JSON (no framework required for MVP). Single HTML file.
- JSON top-level fields: `id` (board identifier, used to namespace localStorage), `cards`, `connections`.
- Card fields: `id` and `text` only. No type, color, or title for MVP.
- Card ID format: `h-1, h-2…` for human-created cards; `ai-1, ai-2…` for AI-created cards. Counters tracked separately, never collide.
- Connection fields: `from`, `to` (directed, arrow points to `to`), and optional `label`. No weight or style.
- JSON loading: drag-and-drop a JSON file onto the canvas to load or reload. File picker (`<input type="file">`) as fallback. No server required. Firefox compatible.
- Browser is read/write: user can create, edit, and delete cards and connections in the UI, then export the updated JSON.
- Connection gesture: shift-click-drag from source card to target card. On drop, a small prompt appears for an optional label (Enter to confirm, Esc for no label). Double-click a connection line to edit its label afterward.
- Card creation: double-click on canvas background spawns a card at that position, immediately editable.
- Card text editing: double-click on an existing card opens it for editing. Enter commits, Esc cancels, click-outside commits. Shift+Enter for newline. Long text wraps inside the card.
- Deletion: single-click selects a card or connection, then Delete/Backspace removes it. Deleting a card removes all its connections.
- Export: two buttons — "Copy JSON" (clipboard) for pasting into the AI CLI, "Download JSON" for saving a file snapshot.
- Auto-layout: force-directed simulation for initial placement. Runs once per new card; saved positions in localStorage take precedence.
- Card positions: auto-layout on first load; user drags to adjust. Positions stored in `localStorage` keyed by card id. Coordinates never written to JSON.

## Open Questions

