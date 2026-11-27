#!/usr/bin/env python3
"""Serve client modules with explicit UTF-8 encoding."""

import argparse
from functools import partial
from io import BytesIO
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REMOTE_MODULE_ROOT = "https://raw.githubusercontent.com/s20210117/vpn-config/main/module/"
CAPTURE_PORTS = {"iqiyi": 18766, "zhihu": 18767, "huya": 18768, "reddit": 18769}


class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Send fresh encoding headers even if an older response was cached.
        for name in ("If-Modified-Since", "If-None-Match"):
            if name in self.headers:
                del self.headers[name]
        path = Path(self.translate_path(self.path))
        if path.is_file() and path.suffix.lower() == ".sgmodule":
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                self.send_error(503, "Module unavailable")
                return None
            address = self.connection.getsockname()[0]
            text = text.replace(REMOTE_MODULE_ROOT, f"http://{address}:{self.server.server_port}/")
            app = path.parent.name
            if app in CAPTURE_PORTS and path.name == app + "-capture.sgmodule":
                text = text.replace("#!arguments=debug:true,collector:off\n",
                                    f"#!arguments=debug:true,collector:http://{address}:{CAPTURE_PORTS[app]}/capture\n")
            data = text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(str(path)))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return BytesIO(data)
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
        # Use the subscription service's interface discovery for matching URLs.
        import sys
        sys.path.insert(0, str(ROOT.parent))
        from subscription_server import lan_addresses
        for address in lan_addresses():
            print(f"Module downloads: http://{address}:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
