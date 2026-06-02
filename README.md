# ai-agent-whiteboard

A bidirectional AI whiteboard to brainstorm codebase feature structure with a platform for the AI to edit the same surface.

## Getting Started

### Prerequisites

- Python 3.10+ (no external packages required)
- A modern web browser

### Start the server

```bash
python3 server.py
# → Whiteboard → http://localhost:8000
```

The server auto-creates a `board.json` on first run. Open the printed URL in your browser to start.

**Options:**

```bash
python3 server.py --help           # show all flags
python3 server.py --port 3000      # use a custom port
python3 server.py board.json       # explicit board file path
```

### Using the AI agent

1. Start the server (`python3 server.py`)
2. Open `http://localhost:8000` in your browser
3. Ask an AI agent (with the whiteboard skill loaded) to add to the board
4. The AI edits `board.json` directly on disk — the browser updates live via SSE

## Board JSON Schema

The shared board is a single JSON file with this structure:

```json
{
  "id": "board-id",
  "cards": [
    { "id": "card-1", "text": "Card label", "parentId": "card-3" }
  ],
  "connections": [
    { "from": "card-1", "to": "card-2", "label": "optional", "scope": "card-3" }
  ],
  "frames": [
    { "id": "frame-1", "text": "Frame Label", "cards": ["card-1"], "scope": "card-3" }
  ]
}
```

**ID conventions:** Cards use `card-N`, frames use `frame-N` (sequential numbering). Connections reference card IDs via `from` and `to`.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Backend | Python 3 stdlib (http.server, threading) |
| Real-time | Server-Sent Events (SSE) via file mtime polling |
| Layout | Custom force-directed physics simulation |

Card positions are stored in `localStorage` only (not in the JSON), keeping the board file clean for AI consumption.
