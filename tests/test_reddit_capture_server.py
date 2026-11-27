"""HTTP integration checks for Reddit diagnostic uploads."""

from http.server import ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener


SPEC = importlib.util.spec_from_file_location(
    "reddit_capture_server", Path(__file__).resolve().parents[1] / "module/reddit/capture_server.py")
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class QuietHandler(SERVICE.Handler):
    def log_message(self, format, *args):
        pass


class RedditCaptureTests(unittest.TestCase):
    def test_upload_status_and_rejection_of_unsanitized_or_unrelated_records(self):
        with tempfile.TemporaryDirectory() as directory:
            QuietHandler.store = SERVICE.CaptureStore(directory)
            server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            base = f"http://127.0.0.1:{server.server_port}"
            client = build_opener(ProxyHandler({}))
            record = {"version": 1, "capturedAt": 1,
                      "request": {"method": "POST", "url": "https://gql-fed.reddit.com/"},
                      "response": {"status": 200, "format": "json", "bodyCharacters": 100},
                      "structure": {"paths": ["$.data=object"], "arrays": [],
                                    "types": {"AdPost": 1}, "truncated": False}}
            try:
                def post(value, token="v1"):
                    return client.open(Request(base + "/capture", json.dumps(value).encode(),
                                               {"Content-Type": "application/json", "X-REDDIT-Capture": token}), timeout=2)

                with post(record) as response:
                    self.assertEqual(response.status, 204)
                with client.open(base + "/status", timeout=2) as response:
                    self.assertEqual(json.load(response)["records"], 1)
                self.assertEqual(json.loads(QuietHandler.store.path.read_text()), record)
                for url in ("https://gql-fed.reddit.com/?token=secret", "https://gql.reddit.com/unknown",
                            "https://gql-fed.reddit.com.evil.test/", "https://www.reddit.com/"):
                    bad = {**record, "request": {**record["request"], "url": url}}
                    with self.subTest(url=url), self.assertRaises(HTTPError) as raised:
                        post(bad)
                    self.assertEqual(raised.exception.code, 422)
                with self.assertRaises(HTTPError) as raised:
                    post({**record, "body": "private"})
                self.assertEqual(raised.exception.code, 422)
                with self.assertRaises(HTTPError) as raised:
                    post(record, "wrong")
                self.assertEqual(raised.exception.code, 403)
                self.assertEqual(QuietHandler.store.count, 1)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
