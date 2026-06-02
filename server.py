#!/usr/bin/env python3
"""
Whiteboard live server.

Serves static files, persists board.json, and pushes external file-change
events to connected browsers via SSE so AI edits are reflected live.

Usage:
    python3 server.py          # default port 8000
    python3 server.py 3000     # custom port
"""
import argparse
import http.server
import json
import os
import subprocess
import sys
import threading
import time

_args = argparse.ArgumentParser(description='Whiteboard live server')
_args.add_argument('board', nargs='?', default='board.json', help='Path to board JSON file (default: board.json)')
_args.add_argument('--port', '-p', type=int, default=8000, help='Port (default: 8000)')
_args = _args.parse_args()

BOARD_FILE = _args.board
PORT = _args.port

_sse_clients: list[list] = []
_sse_lock = threading.Lock()
_last_browser_content: str | None = None
_browser_content_lock = threading.Lock()


def _broadcast(content: str) -> None:
    with _sse_lock:
        for queue in list(_sse_clients):
            queue.append(content)


def _file_watcher() -> None:
    last_mtime: float | None = None
    while True:
        try:
            mtime = os.path.getmtime(BOARD_FILE)
            if mtime != last_mtime:
                last_mtime = mtime
                with open(BOARD_FILE, encoding='utf-8') as f:
                    content = f.read()
                with _browser_content_lock:
                    skip = content == _last_browser_content
                if not skip:
                    _broadcast(content)
        except (FileNotFoundError, OSError):
            pass
        time.sleep(0.5)


class _Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        if self.path == '/board':
            self._get_board()
        elif self.path == '/events':
            self._get_events()
        elif self.path == '/meta':
            self._get_meta()
        else:
            super().do_GET()

    def do_POST(self) -> None:
        if self.path == '/board':
            self._post_board()
        elif self.path == '/open-folder':
            self._post_open_folder()
        else:
            self.send_error(404)

    def _get_board(self) -> None:
        try:
            with open(BOARD_FILE, encoding='utf-8') as f:
                content = f.read()
            body = content.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()

    def _post_board(self) -> None:
        global _last_browser_content
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            json.loads(body)
        except json.JSONDecodeError as exc:
            self.send_error(400, f'Invalid JSON: {exc}')
            return
        content = body.decode('utf-8')
        with _browser_content_lock:
            _last_browser_content = content
        try:
            with open(BOARD_FILE, 'w', encoding='utf-8') as f:
                f.write(content)
            self.send_response(204)
            self.end_headers()
        except OSError as exc:
            self.send_error(500, str(exc))

    def _get_meta(self) -> None:
        body = json.dumps({'path': os.path.abspath(BOARD_FILE)}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _post_open_folder(self) -> None:
        folder = os.path.dirname(os.path.abspath(BOARD_FILE)) or '.'
        cmd = 'open' if sys.platform == 'darwin' else 'xdg-open'
        subprocess.Popen([cmd, folder])
        self.send_response(204)
        self.end_headers()

    def _get_events(self) -> None:
        self.close_connection = True
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        queue: list[str] = []
        with _sse_lock:
            _sse_clients.append(queue)

        try:
            while True:
                if queue:
                    content = queue.pop(0)
                    # Multi-line SSE data: each line prefixed with "data: ".
                    # The browser receives lines joined with \n — valid JSON.
                    lines = '\n'.join(f'data: {line}' for line in content.splitlines())
                    self.wfile.write(f'{lines}\n\n'.encode())
                    self.wfile.flush()
                else:
                    time.sleep(0.1)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _sse_lock:
                if queue in _sse_clients:
                    _sse_clients.remove(queue)

    def log_message(self, fmt: str, *args) -> None:
        code = str(args[1]) if len(args) > 1 else ''
        if code not in ('200', '204', '304', '404'):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    if not os.path.exists(BOARD_FILE):
        stem = os.path.splitext(os.path.basename(BOARD_FILE))[0]
        default = {'id': stem, 'cards': [], 'connections': [], 'frames': []}
        with open(BOARD_FILE, 'w', encoding='utf-8') as f:
            json.dump(default, f)
    threading.Thread(target=_file_watcher, daemon=True).start()
    with http.server.ThreadingHTTPServer(('', PORT), _Handler) as httpd:
        print(f'Whiteboard → http://localhost:{PORT}')
        httpd.serve_forever()
