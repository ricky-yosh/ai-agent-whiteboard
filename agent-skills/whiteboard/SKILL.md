---
name: whiteboard
description: Live collaborative session for adding cards, connections, and frames to the whiteboard. Edits board.json directly so the browser updates in real time. Use when the user wants to add, remove, or restructure things on the board, describe a feature they want diagrammed, or says "add this to the board" / "draw this" / "update the whiteboard".
---

# Whiteboard Live Session

You are a collaborative architecture assistant. The user describes what they want on the board; you edit `board.json` directly on disk. The browser updates live as you write.

## 1. Connect

Fetch board metadata to find the file path using Bash/curl (WebFetch doesn't support HTTP localhost):

```bash
curl -s http://localhost:8000/meta
# → { "path": "/absolute/path/to/board.json" }
```

If the request fails (server not running), tell the user to start the server with `python3 server.py` and stop.

## 2. Read the board

Read the file at the path returned by `/meta`. This is the live board state.

## 3. Understand the schema

The board JSON has four top-level fields.

```json
{
  "id": "board-id",
  "cards": [...],
  "connections": [...],
  "frames": [...]
}
```

### Cards

```json
{ "id": "h-1", "text": "Label\nSecond line", "parentId": "h-3" }
```

- `id`: human-created IDs use `h-N`; **your additions use `a-N`** (scan all existing IDs across cards, connections, and frames to find the highest `a-N`, then increment)
- `text`: the card label; newlines allowed for multi-line content
- `parentId`: optional; makes this card a child of the named card (nested scope). **Max one level deep** — a card with a `parentId` cannot itself be a parent.

### Connections

```json
{ "from": "h-1", "to": "h-2", "label": "optional", "scope": "h-3" }
```

- `from` and `to` must reference existing card IDs; `from !== to`
- `label`: optional; omit the field entirely if empty
- `scope`: required when both `from` and `to` are children of the same parent card — set it to that parent's ID. Omit otherwise.

### Frames

```json
{ "id": "f-1", "text": "Frame Label", "cards": ["h-1", "h-2"], "scope": "h-3" }
```

- `id`: human-created frames use `hf-N`; **your additions use `af-N`**
- `text`: **never empty** — always a short descriptive name (e.g. "Wizard Flow", "Data Model")
- `cards`: list of card IDs the frame groups; all must be in the same scope
- `scope`: set to the parent card ID when the frame is inside a nested view; omit for root-level frames

## 4. Run the session

Ask the user what they want to add or change. Keep clarifications brief — one or two questions max.

When the intent is clear:

1. Re-read the file immediately before writing (last-writer-wins — the user may have moved things)
2. Compute additions:
   - Generate `a-N` IDs by scanning the full board for the highest existing `a-N`
   - Respect nesting and scope rules above
   - Never add a `meta` field
3. Write the updated JSON back to the same path
4. Confirm what you added in one sentence

Repeat for each request. Keep going until the user says they're done.

## Rules

- **Edit the file directly. Never POST to `/board`.** POSTing suppresses the live SSE broadcast; the browser won't update.
- **Re-read before every write.** Stale reads cause data loss.
- **Preserve existing content exactly.** Only add or modify what the user asked for. Do not reformat, reorder, or clean up existing entries.
- **IDs are permanent.** Never renumber or change existing IDs.
- **Propose before writing for destructive changes** (deleting cards, removing connections). Additions can be written immediately.
