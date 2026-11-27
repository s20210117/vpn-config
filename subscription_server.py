#!/usr/bin/env python3
"""Serve the local VPN profile and rule files to trusted LAN devices."""

import argparse
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener


ROOT = Path(__file__).resolve().parent
PORT = 8765
REMOTE_ROOT = "https://raw.githubusercontent.com/s20210117/vpn-config/main"
STATE = Path.home() / "Library/Application Support/vpn-config"
PID_FILE = STATE / "subscription.pid"
LOGS = Path.home() / "Library/Logs/vpn-config"
LAN_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"))
ROUTES = {
    "/config.yaml": (ROOT / "subscription/config.yaml", "text/plain; charset=utf-8"),
    "/ads-merged.mrs": (ROOT / "ads-merged.mrs", "application/octet-stream"),
    "/ads-merged-extra.yaml": (ROOT / "ads-merged-extra.yaml", "text/plain; charset=utf-8"),
}


def local_profile(data, address, port):
    """Render this server's rule downloads without changing the saved profile."""
    lines = data.decode("utf-8").splitlines(keepends=True)
    pattern = re.compile(r"^(\s*)url: " + re.escape(REMOTE_ROOT) +
                         r"/(ads-merged\.mrs|ads-merged-extra\.yaml)\s*$")
    for index, line in enumerate(lines):
        match = pattern.fullmatch(line)
        if not match:
            continue
        indent, name = match.groups()
        lines[index] = f"{indent}url: http://{address}:{port}/{name}\n"
        # Only the containing provider uses DIRECT for its LAN download.
        start, end = index, index + 1
        while start > 0 and (not lines[start - 1].strip() or
                             len(lines[start - 1]) - len(lines[start - 1].lstrip()) >= len(indent)):
            start -= 1
        while end < len(lines) and (not lines[end].strip() or
                                    len(lines[end]) - len(lines[end].lstrip()) >= len(indent)):
            end += 1
        for other in range(start, end):
            if lines[other].startswith(indent + "proxy:"):
                lines[other] = indent + "proxy: DIRECT\n"
    return "".join(lines).encode("utf-8")


class SubscriptionHTTPServer(ThreadingHTTPServer):
    def __init__(self, address, handler):
        self.downloads = {}
        self.download_lock = threading.Lock()
        super().__init__(address, handler)


def allowed_peer(address):
    try:
        peer = ipaddress.ip_address(address)
        return any(peer in network for network in LAN_NETWORKS)
    except ValueError:
        return False


class Handler(BaseHTTPRequestHandler):
    server_version = "VPNConfig/1.0"
    sys_version = ""

    def do_GET(self):
        self.respond(send_body=True)

    def do_HEAD(self):
        self.respond(send_body=False)

    def log_message(self, format, *args):
        # Do not record URLs, headers, or configuration contents.
        pass

    def respond(self, send_body):
        if not allowed_peer(self.client_address[0]):
            self.send_error(403, "LAN access only")
            return
        try:
            requested = urlsplit(self.path)
        except ValueError:
            self.send_error(400, "Invalid request")
            return
        if requested.scheme or requested.netloc or requested.query or requested.fragment:
            self.send_error(404, "Not found")
            return
        if requested.path == "/health":
            with self.server.download_lock:
                data = (json.dumps({"service": "vpn-config", "ok": True,
                                    "downloads": self.server.downloads}) + "\n").encode()
            content_type = "application/json"
        elif requested.path in ROUTES:
            path, content_type = ROUTES[requested.path]
            try:
                data = path.read_bytes()
                if requested.path == "/config.yaml":
                    data = local_profile(data, self.connection.getsockname()[0], self.server.server_port)
            except FileNotFoundError:
                self.send_error(404, "File unavailable")
                return
            except OSError:
                self.send_error(503, "File unavailable")
                return
        else:
            self.send_error(404, "Not found")
            return
        if send_body and requested.path in ROUTES:
            with self.server.download_lock:
                previous = self.server.downloads.get(requested.path, {})
                self.server.downloads[requested.path] = {
                    "requests": previous.get("requests", 0) + 1,
                    "last_client": self.client_address[0],
                    "last_at_utc": datetime.now(timezone.utc).isoformat(),
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("ETag", '"' + hashlib.sha256(data).hexdigest() + '"')
        self.end_headers()
        if send_body:
            self.wfile.write(data)


def lan_addresses():
    result = []
    if sys.platform == "darwin":
        for _, interface in socket.if_nameindex():
            if not interface.startswith("en"):
                continue
            reply = subprocess.run(["/usr/sbin/ipconfig", "getifaddr", interface],
                                   capture_output=True, text=True)
            address = reply.stdout.strip()
            if address and allowed_peer(address) and address not in result:
                result.append(address)
    return result


def healthy():
    try:
        opener = build_opener(ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{PORT}/health", timeout=1) as response:
            data = json.load(response)
        return data.get("service") == "vpn-config" and data.get("ok") is True
    except (OSError, ValueError):
        return False


def show_status():
    print("订阅服务：" + ("运行中" if healthy() else "未运行"))
    for address in lan_addresses():
        print(f"手机订阅地址：http://{address}:{PORT}/config.yaml")
    if sys.platform == "darwin":
        reply = subprocess.run(["/usr/sbin/scutil", "--get", "LocalHostName"], capture_output=True, text=True)
        name = reply.stdout.strip()
        if reply.returncode == 0 and re.fullmatch(r"[A-Za-z0-9-]+", name):
            print(f"电脑名称订阅地址：http://{name}.local:{PORT}/config.yaml")
    print("编辑配置：" + str(ROOT / "subscription/config.yaml"))


def managed_pid():
    if sys.platform != "darwin":
        raise ValueError("后台管理仅支持 macOS；其他平台可使用 serve 前台运行。")
    if not PID_FILE.exists():
        return None
    saved = json.loads(PID_FILE.read_text(encoding="utf-8"))
    pid = int(saved["pid"])
    if pid <= 1:
        return None
    reply = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "args="], capture_output=True, text=True)
    # macOS may replace the python3 launcher path with Python.app's interpreter.
    expected = " -B -u " + saved.get("script", "") + " serve"
    if saved.get("script") and reply.returncode == 0 and reply.stdout.strip().endswith(expected):
        if saved.get("script") != str(Path(__file__).resolve()):
            raise ValueError("服务来自另一个项目位置，请先在原位置停止它。")
        return pid
    return None


def start():
    existing = managed_pid()
    if existing:
        if not healthy():
            raise ValueError("已有后台进程未就绪，请先停止服务再启动。")
        show_status()
        return
    if not (ROOT / "subscription/config.yaml").is_file():
        raise ValueError("请先准备 subscription/config.yaml 完整配置。")
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("0.0.0.0", PORT))
        except OSError:
            raise ValueError("8765 端口已被其他进程占用，未接管或停止它。")
    STATE.mkdir(parents=True, exist_ok=True)
    STATE.chmod(0o700)
    LOGS.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, "-B", "-u", str(Path(__file__).resolve()), "serve"]
    with (LOGS / "subscription.stdout.log").open("ab") as output, (LOGS / "subscription.stderr.log").open("ab") as errors:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=output, stderr=errors,
                                 start_new_session=True, cwd=ROOT)
    PID_FILE.write_text(json.dumps({"pid": child.pid, "script": str(Path(__file__).resolve()),
                                    "command": " ".join(command)}) + "\n", encoding="utf-8")
    PID_FILE.chmod(0o600)
    for _ in range(30):
        if healthy():
            print("后台订阅服务已启动，关闭终端后仍可运行。")
            show_status()
            return
        if child.poll() is not None:
            break
        time.sleep(0.2)
    if child.poll() is None:
        child.terminate()
        child.wait(timeout=3)
    PID_FILE.unlink(missing_ok=True)
    raise ValueError("服务未就绪，请查看日志：" + str(LOGS))


def stop():
    pid = managed_pid()
    if pid:
        os.kill(pid, signal.SIGTERM)
        for _ in range(30):
            if not managed_pid():
                break
            time.sleep(0.1)
        else:
            raise ValueError("后台进程尚未退出，未移除状态文件。")
    PID_FILE.unlink(missing_ok=True)
    print("订阅服务已停止。")


def serve():
    if not (ROOT / "subscription/config.yaml").is_file():
        raise ValueError("找不到 subscription/config.yaml。")
    server = SubscriptionHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"VPN 配置订阅已监听 TCP {PORT}，只接受局域网和本机请求。", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description="VPN 配置局域网订阅服务")
    parser.add_argument("action", choices=("start", "stop", "status", "serve"))
    args = parser.parse_args()
    try:
        {"start": start, "stop": stop, "status": show_status, "serve": serve}[args.action]()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print("失败：" + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
