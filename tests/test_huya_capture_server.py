"""Tests for the local Huya diagnostic receiver."""

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
    "huya_capture_server",
    Path(__file__).resolve().parents[1] / "module/huya/capture_server.py",
)
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class QuietHandler(SERVICE.Handler):
    def log_message(self, format, *args):
        pass


class HuyaCaptureServerTests(unittest.TestCase):
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
                "X-HUYA-Capture": token,
            },
            method="POST",
        )
        return self.client.open(request, timeout=2)

    @staticmethod
    def record(url="https://business.msstatic.com/advertiser/:id"):
        return {
            "version": 1,
            "request": {"method": "GET", "url": url},
            "response": {"status": 200},
            "structure": {"paths": ["data.items[]=array"]},
        }

    def test_default_output_is_huya_capture_directory(self):
        expected = Path(__file__).resolve().parents[1] / "module/huya/captures"
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

    def test_accepts_only_sanitized_records_from_allowed_hosts(self):
        accepted = [
            "https://business.msstatic.com/advertiser/material",
            "https://live-ads.huya.com/live/getAllEntrance",
            "https://dataservice.cdn.huya.com/recommend",
            "https://diy-front.cdn.huya.com/config",
            "https://df.huya.com/feature",
            "http://zt.huya.com/bootstrap",
            "https://us.l.qq.com/exapp",
            "https://tangram.e.qq.com/updateSetting",
            "https://api-access.pangolin-sdk-toutiao.com/api/ad/union/ping",
            "https://pgdt.gtimg.cn/:id/:id/material.webp",
            "https://qn-livewebbs2pcdn.msstatic.com/splash.jpg",
            "http://cdnfile2.msstatic.com/candidate.bin",
            "https://s1-static.msstatic.com/candidate",
            "https://short.msstatic.com/candidate",
            "https://zt.msstatic.com/candidate",
            "https://cdnfile.huya.com/candidate",
            "https://business-qnpcdn.msstatic.com/candidate",
            "https://hd.huya.com/candidate",
            "https://huyapreloadweb.cdn.huya.com/candidate",
            "https://huyaextweb.cdn.huya.com/candidate",
            "https://y2261a742d6a43b3-gtc5tz7i.ext.huya.com/candidate",
            "https://y2261a742d6a43b3-v35epxya.ext.huya.com/candidate",
            "https://y2261a742d6a43b3-sbn47atc.ext.huya.com/candidate",
            "https://diy-assets.msstatic.com/candidate",
            "https://hyext-sdk.msstatic.com/candidate",
            "https://fileserver.cdn.huya.com/candidate",
        ]
        for url in accepted:
            with self.subTest(url=url), self.post(self.record(url)) as response:
                self.assertEqual(response.status, 204)

        cases = [
            (self.record("http://cdn.wup.huya.com/launch/queryHttpDns"), "v1", 422),
            (self.record("https://business.msstatic.com/recommend/123"), "v1", 422),
            (self.record("https://business.msstatic.com/feed?token=secret"), "v1", 422),
            (self.record("https://api.huya.com/feed"), "v1", 422),
            (self.record("https://business.msstatic.com.evil.test/feed"), "v1", 422),
            (self.record("https://huyaextweb.cdn.huya.com.evil.test/feed"), "v1", 422),
            (self.record("https://other.ext.huya.com/feed"), "v1", 422),
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
