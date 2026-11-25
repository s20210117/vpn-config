#!/usr/bin/env python3
"""Serve client modules with explicit UTF-8 encoding."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Send fresh encoding headers even if an older response was cached.
        for name in ("If-Modified-Since", "If-None-Match"):
            if name in self.headers:
                del self.headers[name]
        return super().send_head()

    def guess_type(self, path):
        content_type = super().guess_type(path)
        if Path(path).suffix.lower() in (".js", ".sgmodule", ".md"):
            content_type = "text/plain"
        if content_type.startswith("text/") or content_type in (
                "application/javascript", "application/json"):
            return content_type + "; charset=utf-8"
        return content_type

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18765)
    args = parser.parse_args()
    handler = partial(Handler, directory=str(ROOT))
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f"Module server: port {args.port}, UTF-8", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
