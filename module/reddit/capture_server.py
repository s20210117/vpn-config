#!/usr/bin/env python3
"""Receive Reddit GraphQL structure records without request or response bodies."""

import argparse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "captures"
MAX_RECORD_BYTES = 512 * 1024


class CaptureStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / ("reddit-capture-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".jsonl")
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
    if set(record) != {"version", "capturedAt", "request", "response", "structure"}:
        return False
    request, response, structure = (record.get(key) for key in ("request", "response", "structure"))
    if not all(isinstance(value, dict) for value in (request, response, structure)):
        return False
    return (
        isinstance(record["capturedAt"], (int, float))
        and set(request) == {"method", "url"}
        and request["method"] in ("", "GET", "POST", "HEAD")
        and request["url"] in ("https://gql.reddit.com/", "https://gql-fed.reddit.com/")
        and set(response) == {"status", "format", "bodyCharacters"}
        and isinstance(response["status"], int)
        and response["format"] in ("json", "non-json", "empty")
        and isinstance(response["bodyCharacters"], int)
        and set(structure) == {"paths", "arrays", "types", "truncated"}
        and isinstance(structure["paths"], list)
        and len(structure["paths"]) <= 800
        and all(isinstance(path, str) for path in structure["paths"])
        and isinstance(structure["arrays"], list)
        and len(structure["arrays"]) <= 300
        and all(isinstance(item, dict) and set(item) == {"path", "length"}
                and isinstance(item["path"], str) and isinstance(item["length"], int)
                for item in structure["arrays"])
        and isinstance(structure["types"], dict)
        and len(structure["types"]) <= 200
        and all(isinstance(count, int) for count in structure["types"].values())
        and isinstance(structure["truncated"], bool)
    )


class Handler(BaseHTTPRequestHandler):
    store = None

    def do_GET(self):
        if self.path != "/status":
            self.send_error(404)
            return
        payload = json.dumps({"status": "ready", "records": self.store.count,
                              "file": str(self.store.path)}, ensure_ascii=False).encode("utf-8")
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
        if self.headers.get("X-REDDIT-Capture") != "v1":
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.send_error(411)
            return
        if not 2 <= length <= MAX_RECORD_BYTES:
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18769)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    Handler.store = CaptureStore(args.output)
    with ThreadingHTTPServer((args.bind, args.port), Handler) as server:
        print(f"Reddit capture receiver: port {server.server_port}, /status", flush=True)
        print(f"Output: {Handler.store.path}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
