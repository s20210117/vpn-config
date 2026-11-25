#!/usr/bin/env python3
"""Receive privacy-minimized Zhihu JSON structure records from the phone."""

import argparse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import threading
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "captures"
MAX_RECORD_BYTES = 512 * 1024
UUID_SEGMENT = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
TOKEN_SEGMENT = re.compile(r"^(?:[0-9a-f]{16,}|[A-Za-z0-9_-]{32,})$")


class CaptureStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.path = directory / f"zhihu-capture-{stamp}.jsonl"
        self.count = 0
        self.lock = threading.Lock()

    def append(self, record):
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self.lock:
            with self.path.open("a", encoding="utf-8") as output:
                output.write(line)
            self.count += 1
            return self.count


def path_is_sanitized(path):
    for encoded in path.split("/"):
        if not encoded:
            continue
        segment = unquote(encoded)
        if segment in (":id", ":segment"):
            continue
        if (
            segment.isdigit()
            or UUID_SEGMENT.fullmatch(segment)
            or TOKEN_SEGMENT.fullmatch(segment)
            or len(segment) > 80
        ):
            return False
    return True


def valid_record(record):
    if not isinstance(record, dict) or record.get("version") != 1:
        return False
    request = record.get("request")
    structure = record.get("structure")
    if (
        not isinstance(request, dict)
        or not isinstance(request.get("url"), str)
        or not isinstance(structure, dict)
    ):
        return False
    parsed = urlsplit(request["url"])
    host = (parsed.hostname or "").lower()
    allowed_host = host == "zhihu.com" or host.endswith(".zhihu.com")
    if (
        parsed.scheme not in ("http", "https")
        or not allowed_host
        or parsed.query
        or parsed.fragment
        or not path_is_sanitized(parsed.path)
    ):
        return False
    return True


class Handler(BaseHTTPRequestHandler):
    store = None

    def do_GET(self):
        if self.path != "/status":
            self.send_error(404)
            return
        payload = json.dumps(
            {
                "status": "ready",
                "records": self.store.count,
                "file": str(self.store.path),
            },
            ensure_ascii=False,
        ).encode("utf-8")
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
        if self.headers.get("X-ZHIHU-Capture") != "v1":
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
    parser.add_argument("--port", type=int, default=18767)
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
