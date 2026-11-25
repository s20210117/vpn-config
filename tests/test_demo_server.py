"""Regressions for Chinese source downloads and cached encoding headers."""

from functools import partial
from http.server import ThreadingHTTPServer
import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener


SPEC = importlib.util.spec_from_file_location(
    "demo_server", Path(__file__).resolve().parents[1] / "module/serve.py")
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class QuietHandler(SERVICE.Handler):
    def log_message(self, format, *args):
        pass


class DemoServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.sources = {
            "demo/demo.js": 'function main(config) { config.name = "覆写 Demo"; return config; }\n',
            "demo/demo.sgmodule": "#!name=模块演示\n#!desc=中文下载检查\n",
            "demo/README.md": "# 中文说明\n覆写脚本与模块。\n",
            "status.json": '{"message":"中文检查通过"}\n',
        }
        for name, text in self.sources.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(text.encode("utf-8"))
        self.binary = b"\x00\xff\xfe\x80\r\n"
        (self.root / "demo/rules.bin").write_bytes(self.binary)
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(QuietHandler, directory=str(self.root)))
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)
        self.client = build_opener(ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=2)
        self.directory.cleanup()

    def test_chinese_downloads_use_declared_encoding(self):
        for name, text in self.sources.items():
            with self.subTest(file=name):
                with self.client.open(self.base + "/" + name, timeout=2) as response:
                    charset = response.headers.get_content_charset()
                    self.assertEqual(charset, "utf-8")
                    self.assertEqual(response.read().decode(charset), text)
                    expected_type = "application/json" if name.endswith(".json") else "text/plain"
                    self.assertEqual(response.headers.get_content_type(), expected_type)
                    self.assertIn("no-store", response.headers["Cache-Control"])
                    self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_head_reports_encoding_and_byte_length(self):
        name = "demo/demo.js"
        request = Request(self.base + "/" + name, method="HEAD")
        with self.client.open(request, timeout=2) as response:
            self.assertEqual(response.read(), b"")
            self.assertEqual(response.headers.get_content_charset(), "utf-8")
            self.assertEqual(int(response.headers["Content-Length"]),
                             len(self.sources[name].encode("utf-8")))

    def test_cached_response_is_replaced_with_encoding_headers(self):
        url = self.base + "/demo/demo.js"
        with self.client.open(url, timeout=2) as response:
            modified = response.headers["Last-Modified"]
        request = Request(url, headers={
            "If-Modified-Since": modified,
            "If-None-Match": '"old-response-without-charset"',
        })
        with self.client.open(request, timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_charset(), "utf-8")
            self.assertEqual(response.read(), self.sources["demo/demo.js"].encode("utf-8"))

    def test_binary_download_is_not_transcoded(self):
        with self.client.open(self.base + "/demo/rules.bin", timeout=2) as response:
            self.assertEqual(response.headers.get_content_type(), "application/octet-stream")
            self.assertIsNone(response.headers.get_content_charset())
            self.assertEqual(response.read(), self.binary)

    def test_old_flat_module_paths_are_not_supported(self):
        for path in ("/demo.sgmodule", "/demo/override-demo.js", "/zhihu-adblock.sgmodule", "/iqiyi-adblock.sgmodule"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as raised:
                self.client.open(self.base + path, timeout=2)
            self.assertEqual(raised.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
