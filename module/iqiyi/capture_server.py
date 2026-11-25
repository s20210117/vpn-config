#!/usr/bin/env python3
"""Receive privacy-minimized iQIYI JSON structure records from the phone."""

import argparse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "captures"
MAX_RECORD_BYTES = 512 * 1024
ALLOWED_ADDRESSES = {
    "59.39.2.11", "116.211.198.237", "111.63.147.158", "103.44.59.54"
}


class CaptureStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.path = directory / f"iqiyi-capture-{stamp}.jsonl"
        self.count = 0
        self.lock = threading.Lock()

    def append(self, record):
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self.lock:
            with self.path.open("a", encoding="utf-8") as output:
                output.write(line)
            self.count += 1
            return self.count


def valid_record(record):
    if not isinstance(record, dict) or record.get("version") != 1:
        return False
    request = record.get("request")
    if not isinstance(request, dict) or not isinstance(request.get("url"), str):
        return False
    parsed = urlsplit(request["url"])
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or parsed.query or parsed.fragment:
        return False
    return host.endswith(".iqiyi.com") or host in ALLOWED_ADDRESSES


class Handler(BaseHTTPRequestHandler):
    store = None

    def do_GET(self):
        if self.path != "/status":
            self.send_error(404)
            return
        payload = json.dumps({
            "status": "ready",
            "records": self.store.count,
            "file": str(self.store.path),
        }, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path != "/capture":
            self.send_error(404)
            return
        if self.headers.get("X-IQIYI-Capture") != "v1":
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.send_error(411)
            return
        if length < 2 or length > MAX_RECORD_BYTES:
            self.send_error(413)
            return
        try:
            record = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400)
            return
        if not valid_record(record):
            self.send_error(422)
            return
        number = self.store.append(record)
        print(f"Captured #{number}: {record['request']['url']}", flush=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18766)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    Handler.store = CaptureStore(args.output)
    with ThreadingHTTPServer((args.bind, args.port), Handler) as server:
        print(f"Capture receiver: http://{args.bind}:{args.port}/status", flush=True)
        print(f"Output: {Handler.store.path}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
