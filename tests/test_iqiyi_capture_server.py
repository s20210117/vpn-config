"""Tests for the local iQIYI diagnostic receiver."""

from functools import partial
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
    "capture_server",
    Path(__file__).resolve().parents[1] / "module/iqiyi/capture_server.py",
)
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class QuietHandler(SERVICE.Handler):
    def log_message(self, format, *args):
        pass


class CaptureServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        QuietHandler.store = SERVICE.CaptureStore(self.directory.name)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.client = build_opener(ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=2)
        self.directory.cleanup()

    def post(self, record, token="v1"):
        payload = json.dumps(record).encode("utf-8")
        request = Request(
            self.base + "/capture",
            data=payload,
            headers={"Content-Type": "application/json", "X-IQIYI-Capture": token},
            method="POST",
        )
        return self.client.open(request, timeout=2)

    def test_default_output_is_iqiyi_capture_directory(self):
        expected = Path(__file__).resolve().parents[1] / "module/iqiyi/captures"
        self.assertEqual(SERVICE.DEFAULT_OUTPUT, expected)
        self.assertNotIn("runtime", SERVICE.DEFAULT_OUTPUT.parts)

    def test_accepts_sanitized_record_and_reports_status(self):
        record = {
            "version": 1,
            "request": {"method": "GET", "url": "https://api.iqiyi.com/feed"},
            "response": {"status": 200},
            "structure": {"paths": ["data=object"]},
        }
        with self.post(record) as response:
            self.assertEqual(response.status, 204)
        saved = [json.loads(line) for line in QuietHandler.store.path.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(saved, [record])
        with self.client.open(self.base + "/status", timeout=2) as response:
            status = json.load(response)
        self.assertEqual(status["records"], 1)
        self.assertEqual(status["status"], "ready")

    def test_rejects_query_strings_unrelated_hosts_and_missing_token(self):
        for url, token, status in [
            ("https://api.iqiyi.com/feed?token=secret", "v1", 422),
            ("https://example.com/feed", "v1", 422),
            ("https://api.iqiyi.com/feed", "wrong", 403),
        ]:
            with self.subTest(url=url, token=token):
                with self.assertRaises(HTTPError) as raised:
                    self.post({"version": 1, "request": {"url": url}}, token=token)
                self.assertEqual(raised.exception.code, status)


if __name__ == "__main__":
    unittest.main()
