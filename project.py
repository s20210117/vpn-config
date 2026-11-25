#!/usr/bin/env python3
"""Portable entry point for the saved Mihomo ad-rule project."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project_files():
    return sorted(path for path in ROOT.rglob("*") if path.is_file()
                  and path.name != ".DS_Store"
                  and path.suffix != ".pyc"
                  and not any(part in ("__pycache__", ".git")
                              for part in path.relative_to(ROOT).parts)
                  and path.relative_to(ROOT).parts[0] != "subscription")


def check():
    manifest_path = ROOT / "inputs/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    inputs = list(manifest["domain_providers"].values()) + [
        manifest["adguard_extra"], manifest["false_positive_exclusions"]]
    for entry in inputs:
        if digest(ROOT / "inputs" / entry["file"]) != entry["sha256"]:
            raise ValueError("输入快照不一致：" + entry["file"])
    if (ROOT / "sources-manifest.json").read_bytes() != manifest_path.read_bytes():
        raise ValueError("sources-manifest.json 与 inputs/manifest.json 不一致")
    build = json.loads((ROOT / "build-report.json").read_text(encoding="utf-8"))
    if digest(manifest_path) != build["input_manifest_sha256"]:
        raise ValueError("生成记录与输入清单不一致")
    for name, entry in build["files"].items():
        path = ROOT / name
        if digest(path) != entry["sha256"] or path.stat().st_size != entry["bytes"]:
            raise ValueError("最终产物与生成记录不一致：" + name)
    scripts = [path for path in project_files() if path.suffix == ".py"]
    for path in scripts:
        compile(path.read_bytes(), str(path), "exec")
    print(f"检查通过：{len(inputs)} 份构建输入、{len(scripts)} 个 Python 脚本。")
    print(f"最终规则：MRS {build['merged_mrs_rules']:,} 条；补充 YAML {build['output_extra_rules']:,} 条。")


def resolve_core(value):
    candidate = Path(value).expanduser()
    found = str(candidate.resolve()) if candidate.is_file() else shutil.which(value)
    if not found or not os.access(found, os.X_OK):
        raise ValueError("找不到可执行的 Mihomo 内核：" + value)
    return found


def main():
    parser = argparse.ArgumentParser(description="Mihomo 广告规则项目：检查、重建和测试。")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="检查完整性和 Python 语法，无需内核或网络")
    subscription = commands.add_parser("subscription", help="管理手机局域网配置订阅")
    subscription.add_argument("action", choices=("start", "stop", "status", "serve"))
    for command, help_text in (("build", "从 inputs 快照重建最终规则"),
                               ("test", "启动隔离内核并对照合并前后的匹配")):
        item = commands.add_parser(command, help=help_text)
        item.add_argument("--mihomo", required=True, help="Mihomo 可执行文件路径或 PATH 中的名称")
    args = parser.parse_args()
    try:
        if args.command == "check":
            check()
        elif args.command == "subscription":
            subprocess.run([sys.executable, "-B", str(ROOT / "subscription_server.py"), args.action], check=True)
        else:
            core = resolve_core(args.mihomo)
            script = "build_merged.py" if args.command == "build" else "validate_merged.py"
            subprocess.run([sys.executable, "-B", str(ROOT / script), core], cwd=ROOT, check=True)
            check()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print("失败：" + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
