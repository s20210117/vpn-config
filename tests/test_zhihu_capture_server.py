"""Tests for the local Zhihu diagnostic receiver."""

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
    "zhihu_capture_server",
    Path(__file__).resolve().parents[1] / "module/zhihu/capture_server.py",
)
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class QuietHandler(SERVICE.Handler):
    def log_message(self, format, *args):
        pass


class ZhihuCaptureServerTests(unittest.TestCase):
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
            headers={
                "Content-Type": "application/json",
                "X-ZHIHU-Capture": token,
            },
            method="POST",
        )
        return self.client.open(request, timeout=2)

    @staticmethod
    def record(url="https://api.zhihu.com/questions/:id/feeds"):
        return {
            "version": 1,
            "request": {"method": "GET", "url": url},
            "response": {"status": 200},
            "structure": {"paths": ["data.items[]=array"]},
        }

    def test_default_output_is_zhihu_capture_directory(self):
        expected = Path(__file__).resolve().parents[1] / "module/zhihu/captures"
        self.assertEqual(SERVICE.DEFAULT_OUTPUT, expected)
        self.assertNotIn("runtime", SERVICE.DEFAULT_OUTPUT.parts)

    def test_accepts_sanitized_record_and_reports_status(self):
        record = self.record()
        with self.post(record) as response:
            self.assertEqual(response.status, 204)
        saved = [
            json.loads(line)
            for line in QuietHandler.store.path.read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(saved, [record])
        with self.client.open(self.base + "/status", timeout=2) as response:
            status = json.load(response)
        self.assertEqual(status["records"], 1)
        self.assertEqual(status["status"], "ready")

    def test_rejects_unsanitized_or_untrusted_records(self):
        cases = [
            (self.record("https://api.zhihu.com/questions/123/feeds"), "v1", 422),
            (self.record("https://api.zhihu.com/feed?token=secret"), "v1", 422),
            (self.record("https://api.zhihu.com.evil.test/feed"), "v1", 422),
            (self.record("https://43.242.197.211/topstory/recommend"), "v1", 422),
            (self.record("https://example.com/feed"), "v1", 422),
            (self.record(), "wrong", 403),
        ]
        for record, token, expected in cases:
            with self.subTest(url=record["request"]["url"], token=token):
                with self.assertRaises(HTTPError) as raised:
                    self.post(record, token)
                self.assertEqual(raised.exception.code, expected)


if __name__ == "__main__":
    unittest.main()
