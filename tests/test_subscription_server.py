"""Check profile delivery, live edits, and restricted file access."""

import importlib.util
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener


SPEC = importlib.util.spec_from_file_location(
    "subscription_server", Path(__file__).resolve().parents[1] / "subscription_server.py")
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class SubscriptionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "config.yaml"
        self.path.write_bytes(b"proxies: []\nrules: [MATCH,DIRECT]\n")
        self.previous = SERVICE.ROUTES
        SERVICE.ROUTES = {"/config.yaml": (self.path, "application/yaml; charset=utf-8")}
        self.server = SERVICE.SubscriptionHTTPServer(("127.0.0.1", 0), SERVICE.Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)
        self.client = build_opener(ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=2)
        SERVICE.ROUTES = self.previous
        self.directory.cleanup()

    def test_profile_and_head(self):
        with self.client.open(self.base + "/config.yaml", timeout=2) as response:
            self.assertEqual(response.read(), self.path.read_bytes())
            self.assertIn("no-store", response.headers["Cache-Control"])
            self.assertEqual(int(response.headers["Content-Length"]), self.path.stat().st_size)
        with self.client.open(Request(self.base + "/config.yaml", method="HEAD"), timeout=2) as response:
            self.assertEqual(response.read(), b"")
            self.assertEqual(int(response.headers["Content-Length"]), self.path.stat().st_size)

    def test_saved_edit_is_served_without_restart(self):
        with self.client.open(self.base + "/config.yaml", timeout=2) as response:
            before = response.headers["ETag"]
        updated = b"proxies: []\nrules: []\n"
        self.path.write_bytes(updated)
        with self.client.open(self.base + "/config.yaml", timeout=2) as response:
            self.assertEqual(response.read(), updated)
            self.assertNotEqual(response.headers["ETag"], before)

    def test_download_status_contains_metadata_only(self):
        import json
        with self.client.open(self.base + "/config.yaml", timeout=2) as response:
            response.read()
        with self.client.open(self.base + "/health", timeout=2) as response:
            status = json.load(response)
        record = status["downloads"]["/config.yaml"]
        self.assertEqual(record["requests"], 1)
        self.assertEqual(record["last_client"], "127.0.0.1")
        self.assertEqual(record["bytes"], self.path.stat().st_size)
        self.assertEqual(len(record["sha256"]), 64)
        self.assertNotIn("proxies:", json.dumps(status))

    def test_other_files_and_query_strings_are_unavailable(self):
        for route in ("/", "/subscription/original.yaml", "/inputs/manifest.json",
                      "/../subscription/original.yaml", "/%2e%2e/subscription/original.yaml",
                      "/config.yaml?token=example", "/subscription/config.yaml"):
            with self.subTest(route=route):
                with self.assertRaises(HTTPError) as error:
                    self.client.open(self.base + route, timeout=2)
                self.assertEqual(error.exception.code, 404)

    def test_server_rejects_writes(self):
        with self.assertRaises(HTTPError) as error:
            self.client.open(Request(self.base + "/config.yaml", data=b"overwrite", method="POST"), timeout=2)
        self.assertEqual(error.exception.code, 501)
        self.assertNotEqual(self.path.read_bytes(), b"overwrite")

    def test_source_address_filter(self):
        for peer in ("127.0.0.1", "192.168.2.199", "10.2.3.4", "172.16.2.3"):
            self.assertTrue(SERVICE.allowed_peer(peer))
        for peer in ("8.8.8.8", "1.1.1.1", "172.32.0.1", "invalid"):
            self.assertFalse(SERVICE.allowed_peer(peer))

    def test_process_identity_survives_python_launcher_change(self):
        import json
        state = Path(self.directory.name) / "subscription.pid"
        script = str(Path(SERVICE.__file__).resolve())
        state.write_text(json.dumps({"pid": 12345, "script": script}), encoding="utf-8")
        reply = SimpleNamespace(returncode=0, stdout="/other/Python.app/Python -B -u " + script + " serve\n")
        with patch.object(SERVICE, "PID_FILE", state), patch.object(SERVICE.sys, "platform", "darwin"), \
                patch.object(SERVICE.subprocess, "run", return_value=reply):
            self.assertEqual(SERVICE.managed_pid(), 12345)
            reply.stdout = "/usr/bin/some-other-process\n"
            self.assertIsNone(SERVICE.managed_pid())


if __name__ == "__main__":
    unittest.main()
