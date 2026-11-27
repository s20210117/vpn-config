#!/usr/bin/env python3
"""Validate the saved sources and local domains against the MRS/YAML pair.

Uses a separate reversed-label index, an independent classical-rule parser,
full source-clause coverage proofs, regex/exception boundaries, and two local
mihomo cores. No requests are forwarded to external sites.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import collections
import hashlib
import http.client
import ipaddress
import json
import random
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

sys.dont_write_bytecode = True
import test_support as audit

ROOT = Path(__file__).resolve().parent
MARKER = b"LOCAL-MERGED-ADS-VALIDATION"


def payload(file):
    return [json.loads(line[4:]) for line in file.read_text().splitlines() if line.startswith("  - ")]


class DomainIndex:
    """Independent index: suffix terminal flags on a reversed label trie."""
    def __init__(self, rules):
        self.trie = {}
        for rule in rules:
            suffix = rule.startswith("+.")
            host = rule[2:] if suffix else rule
            node = self.trie
            for label in reversed(host.lower().split(".")):
                node = node.setdefault(label, {})
            node["@suffix" if suffix else "@exact"] = True

    def covers_clause(self, rule):
        suffix = rule.startswith("+.")
        host = rule[2:] if suffix else rule
        node = self.trie
        for label in reversed(host.lower().split(".")):
            node = node.get(label)
            if node is None:
                return False
            if node.get("@suffix"):
                return True
        return not suffix and bool(node.get("@exact"))

    def __call__(self, host):
        return self.covers_clause(host)


class LocalProxy(BaseHTTPRequestHandler):
    def do_CONNECT(self):
        self.send_response(200)
        self.end_headers()
        self.connection.settimeout(10)
        self.handle_one_request()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", str(len(MARKER)))
        self.end_headers()
        self.wfile.write(MARKER)

    def log_message(self, *args):
        pass


class TestServer(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def leaves(expression):
    kind, value = expression.split(",", 1)
    if kind in ("DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-REGEX"):
        return {expression}
    result = set()
    for child in audit.logical_children(expression):
        result.update(leaves(child))
    return result


def exclusion_payload(file):
    return {line.strip() for line in file.read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")}


def excluded_host(host, exclusions):
    host = host.lower()
    return any(host == item[2:] or host.endswith("." + item[2:]) for item in exclusions)


def excluded_entry(entry, exclusions):
    host = entry[2:] if entry.startswith("+.") else entry
    return excluded_host(host, exclusions)


def run_cores(core, manifest, merged_count, extra_count, hosts, expectations, temp, exclusions):
    servers, ports, logs, processes = {}, {}, {}, []
    reserved = set()
    all_connections = []

    def port():
        while True:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                number = sock.getsockname()[1]
            if number not in reserved:
                reserved.add(number)
                return number

    try:
        counts, loaded_counts = {}, {}
        for variant in ("source", "merged"):
            servers[variant] = TestServer(("127.0.0.1", 0), LocalProxy)
            threading.Thread(target=servers[variant].serve_forever, daemon=True).start()
            proxy_port, api_port = port(), port()
            ports[variant] = proxy_port, api_port
            home = temp / variant
            home.mkdir()
            if variant == "source":
                providers = {name: (ROOT / "inputs" / info["file"], "domain", "mrs", info["rules"])
                             for name, info in manifest["domain_providers"].items()}
                providers["adguard-extra"] = (ROOT / "inputs" / manifest["adguard_extra"]["file"], "classical", "yaml", manifest["adguard_extra"]["rules"])
                providers["local-domains"] = (ROOT / "inputs" / manifest["local_domains"]["file"], "domain", "text", manifest["local_domains"]["rules"])
            else:
                providers = {"ads-merged": (ROOT / "ads-merged.mrs", "domain", "mrs", merged_count)}
                if extra_count:
                    providers["ads-merged-extra"] = (ROOT / "ads-merged-extra.yaml", "classical", "yaml", extra_count)
            counts[variant] = {name: item[3] for name, item in providers.items()}
            config = ["mixed-port: " + str(proxy_port), "bind-address: 127.0.0.1",
                      "external-controller: 127.0.0.1:" + str(api_port), "mode: rule",
                      "log-level: info", "find-process-mode: off", "proxies:",
                      "  - name: LOCAL-TEST-SINK", "    type: http", "    server: 127.0.0.1",
                      "    port: " + str(servers[variant].server_port), "rule-providers:"]
            for name, (file, behavior, fmt, count) in providers.items():
                (home / file.name).write_bytes(file.read_bytes())
                config += ["  " + name + ":", "    type: file", "    behavior: " + behavior,
                           "    format: " + fmt, "    path: ./" + file.name]
            config += ["rules:"]
            if variant == "source":
                # Domain providers fold case; inline DOMAIN-SUFFIX rules do not.
                # Model the reviewed exclusions with the same DNS case behavior.
                config += ["  - DOMAIN-REGEX,(?i)(^|\\.)" + re.escape(item[2:]) + "$" + ",LOCAL-TEST-SINK"
                           for item in sorted(exclusions)]
            config += ["  - RULE-SET," + name + ",REJECT" for name in providers]
            config += ["  - MATCH,LOCAL-TEST-SINK"]
            path = home / "config.yaml"
            path.write_text("\n".join(config) + "\n")
            check = subprocess.run([core, "-t", "-d", str(home), "-f", str(path)], capture_output=True, text=True, timeout=45)
            with (ROOT / "validation.log").open("a") as log:
                log.write(variant + "\n" + check.stdout + check.stderr)
            if check.returncode:
                raise RuntimeError("Core config check failed for " + variant)
            logs[variant] = open(home / "core.log", "w+")
            processes.append(subprocess.Popen([core, "-d", str(home), "-f", str(path)], stdout=logs[variant], stderr=subprocess.STDOUT))
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            ready = True
            for variant, (_, api_port) in ports.items():
                try:
                    with urllib.request.urlopen("http://127.0.0.1:" + str(api_port) + "/providers/rules", timeout=1) as response:
                        providers = json.load(response).get("providers") or {}
                    loaded_counts[variant] = {name: (providers.get(name) or {}).get("ruleCount") for name in counts[variant]}
                    # Upstream MRS headers can count redundant source entries,
                    # while decoding emits their compact trie entries. The
                    # source file hash and all decoded entries are verified
                    # independently; report both counts instead of assuming
                    # that these two meanings of ruleCount are identical.
                    ready &= all(isinstance(count, int) and count > 0 for count in loaded_counts[variant].values())
                    if variant == "merged":
                        ready &= loaded_counts[variant] == counts[variant]
                except (OSError, ValueError):
                    ready = False
            if ready:
                break
            if any(process.poll() is not None for process in processes):
                raise RuntimeError("A test core exited before readiness")
            time.sleep(.1)
        else:
            raise RuntimeError(("Provider loading did not become ready", loaded_counts, counts))
        connections, lock = threading.local(), threading.Lock()

        def probe(item):
            variant, host = item
            if not hasattr(connections, "items"):
                connections.items = {}
            if variant not in connections.items:
                connection = http.client.HTTPConnection("127.0.0.1", ports[variant][0], timeout=12)
                connections.items[variant] = connection
                with lock:
                    all_connections.append(connection)
            conn = connections.items[variant]
            conn.request("GET", "http://" + host + "/union-check", headers={
                "Host": host, "Connection": "keep-alive", "Proxy-Connection": "keep-alive"})
            response = conn.getresponse()
            body, status = response.read(), response.status
            if MARKER in body:
                return variant, host, "fallthrough"
            if status in (502, 403):
                return variant, host, "blocked"
            raise RuntimeError((variant, host, status, body[:100]))

        controls = {"doubleclick.net": "blocked", "clean.union-regression.invalid": "fallthrough"}
        for host, expected in controls.items():
            if expectations[host] != expected:
                raise AssertionError(("Bad independent control", host))
        startup_mismatches = 0
        deadline = time.monotonic() + 10
        while True:
            failures = []
            for variant in ports:
                for host, expected in controls.items():
                    if probe((variant, host))[2] != expected:
                        failures.append((variant, host))
            if not failures:
                break
            startup_mismatches += len(failures)
            if time.monotonic() >= deadline:
                raise RuntimeError(("Core control routing not ready", failures))
            time.sleep(.2)
        actual = {variant: {} for variant in ports}
        jobs = [(variant, host) for host in hosts for variant in ports]
        with ThreadPoolExecutor(max_workers=8) as pool:
            for start in range(0, len(jobs), 2000):
                for variant, host, outcome in pool.map(probe, jobs[start:start + 2000]):
                    actual[variant][host] = outcome
                print("Core routing probes: " + str(min(start + 2000, len(jobs))) + "/" + str(len(jobs)), flush=True)
        differences = {host: {variant: actual[variant][host] for variant in ports} for host in hosts
                       if actual["source"][host] != actual["merged"][host]}
        errors = {variant: {host: {"expected": expected, "actual": actual[variant][host]}
                            for host, expected in expectations.items() if actual[variant][host] != expected}
                  for variant in ports}
        transport = []
        for variant, log in logs.items():
            log.flush()
            log.seek(0)
            transport += [{"variant": variant, "log": line.strip()} for line in log if "[TCP]" in line and " error:" in line]
        (ROOT / "runtime-results.json").write_text(json.dumps({"actual": actual, "routing_differences": differences,
            "oracle_errors": errors, "transport_errors": transport}, ensure_ascii=False, indent=2) + "\n")
        if differences or any(errors.values()) or transport:
            raise AssertionError({"differences": list(differences.items())[:8],
                                  "oracle_errors": {k: list(v.items())[:8] for k, v in errors.items()},
                                  "transport_errors": transport[:3]})
        return {"hostnames": len(hosts), "requests": len(jobs), "independent_expectations": len(expectations),
                "ip_literal_equivalence_cases": len(hosts) - len(expectations),
                "routing_differences": 0, "oracle_errors": 0, "transport_errors": 0,
                "startup_control_mismatches": startup_mismatches, "decoded_provider_counts": counts,
                "provider_api_counts": loaded_counts,
                "outcomes": dict(collections.Counter(actual["source"].values()))}
    except BaseException:
        diagnostics = []
        for variant, log in logs.items():
            log.flush()
            log.seek(0)
            diagnostics.append(variant + "\n" + log.read()[-16000:])
        (ROOT / "core-diagnostics.log").write_text("\n".join(diagnostics))
        raise
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for conn in all_connections:
            conn.close()
        for server in servers.values():
            server.shutdown()
            server.server_close()
        for log in logs.values():
            log.close()


def main():
    core = str(Path(sys.argv[1]).resolve())
    started = time.monotonic()
    for name in ("test-report.json", "runtime-results.json", "validation.log"):
        (ROOT / name).unlink(missing_ok=True)
    manifest = json.loads((ROOT / "inputs/manifest.json").read_text())
    build = json.loads((ROOT / "build-report.json").read_text())
    exclusion_info = manifest["false_positive_exclusions"]
    exclusion_file = ROOT / "inputs" / exclusion_info["file"]
    if hashlib.sha256(exclusion_file.read_bytes()).hexdigest() != exclusion_info["sha256"]:
        raise AssertionError("False-positive exclusions changed")
    exclusions = exclusion_payload(exclusion_file)
    if len(exclusions) != exclusion_info["rules"] or sorted(exclusions) != build["false_positive_exclusions"]:
        raise AssertionError("False-positive exclusion metadata mismatch")
    if hashlib.sha256((ROOT / "inputs/manifest.json").read_bytes()).hexdigest() != build["input_manifest_sha256"]:
        raise AssertionError("Build manifest changed")
    for name, metadata in build["files"].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != metadata["sha256"]:
            raise AssertionError("Build output changed: " + name)
    if len(sys.argv) > 2 and sys.argv[2] == "--runtime-only":
        cached = json.loads((ROOT / "validation-cases.json").read_text())
        if cached["output_hashes"] != {name: data["sha256"] for name, data in build["files"].items()} or cached["manifest_sha256"] != build["input_manifest_sha256"]:
            raise AssertionError("Cached validation corpus belongs to different inputs/outputs")
        for metadata in list(manifest["domain_providers"].values()) + [manifest["adguard_extra"], exclusion_info, manifest["local_domains"]]:
            if hashlib.sha256((ROOT / "inputs" / metadata["file"]).read_bytes()).hexdigest() != metadata["sha256"]:
                raise AssertionError("Cached validation input changed")
        with tempfile.TemporaryDirectory(prefix="merged-ads-test-") as directory:
            runtime = run_cores(core, manifest, build["merged_mrs_rules"], build["output_extra_rules"], cached["hosts"], cached["expected"], Path(directory), exclusions)
        finish(cached["partial_report"], runtime, build, started)
        return
    if hashlib.sha256((ROOT / "inputs" / manifest["adguard_extra"]["file"]).read_bytes()).hexdigest() != manifest["adguard_extra"]["sha256"]:
        raise AssertionError("Original AdGuard companion changed")
    original_extra = payload(ROOT / "inputs" / manifest["adguard_extra"]["file"])
    merged_extra = payload(ROOT / "ads-merged-extra.yaml")
    local_info = manifest["local_domains"]
    local_file = ROOT / "inputs" / local_info["file"]
    if hashlib.sha256(local_file.read_bytes()).hexdigest() != local_info["sha256"]:
        raise AssertionError("Local domain input changed")
    local_lines = [line.strip() for line in local_file.read_text().splitlines()
                   if line.strip() and not line.lstrip().startswith("#")]
    local_domains = set(local_lines)
    if len(local_domains) != local_info["rules"] or len(local_lines) != len(local_domains):
        raise AssertionError("Local domain count mismatch")
    with tempfile.TemporaryDirectory(prefix="merged-ads-test-") as directory:
        temp = Path(directory)
        original = set()
        for name, metadata in manifest["domain_providers"].items():
            path = ROOT / "inputs" / metadata["file"]
            if hashlib.sha256(path.read_bytes()).hexdigest() != metadata["sha256"]:
                raise AssertionError("Input changed: " + name)
            decoded = temp / (name + ".txt")
            subprocess.run([core, "convert-ruleset", "domain", "mrs", str(path), str(decoded)], check=True)
            lines = decoded.read_text().splitlines()
            if len(lines) != metadata["rules"]:
                raise AssertionError("Input count mismatch: " + name)
            original.update(lines)
        original.update(local_domains)
        decoded = temp / "merged.txt"
        subprocess.run([core, "convert-ruleset", "domain", "mrs", str(ROOT / "ads-merged.mrs"), str(decoded)], check=True)
        merged = set(decoded.read_text().splitlines())
        if len(merged) != build["merged_mrs_rules"]:
            raise AssertionError("Output MRS count mismatch")
        source_index, target_index = DomainIndex(original), DomainIndex(merged)
        missing = [rule for rule in original
                   if not excluded_entry(rule, exclusions) and not target_index.covers_clause(rule)]
        if missing:
            raise AssertionError(("Source scope not covered", missing[:5]))
        unexpected = merged - original - set(build["promoted_regex_rules"].values())
        if unexpected:
            raise AssertionError(("Unjustified new domain scope", list(unexpected)[:5]))
        source_other, target_other = audit.Matcher(original_extra), audit.Matcher(merged_extra)
        original_policy = lambda host: not excluded_host(host, exclusions) and (source_index(host) or source_other(host))
        merged_policy = lambda host: target_index(host) or target_other(host)
        # Every original domain root and descendant, plus literal/regex
        # boundaries from both policies. Structural coverage above proves the
        # full suffix scope, including descendants absent from this corpus.
        hosts, critical, ip_literals = set(), set(), set()
        migration_hosts = {"api.zhihu.com", "www.zhihu.com", "cards.iqiyi.com",
                           "iface2.iqiyi.com", "l-rcd.iqiyi.com", "subscription.iqiyi.com",
                           "cdn.wup.huya.com", "wup.huya.com", "wsapi.huya.com",
                           "livewebbs2.msstatic.com", "p2p.huya.com", "child.p2p.huya.com"}
        for rule in local_domains:
            migration_hosts.update(audit.domain_boundaries(rule[2:] if rule.startswith("+.") else rule))
        critical.update(migration_hosts)
        for item in exclusions:
            critical.update(audit.domain_boundaries(item[2:]))
            migration_hosts.update(audit.domain_boundaries(item[2:]))
        for rule in original:
            host = rule[2:] if rule.startswith("+.") else rule
            hosts.update((host, "child." + host))
        all_leaves = set()
        for rule in original_extra + merged_extra:
            all_leaves.update(leaves(rule))
        regex_count = 0
        for leaf in sorted(all_leaves):
            kind, value = leaf.split(",", 1)
            if kind != "DOMAIN-REGEX":
                critical.update(audit.domain_boundaries(value))
                continue
            regex_count += 1
            for variant in range(16):
                raw = audit.regex_witness(value, variant)
                for prefix, suffix in (("", ""), ("witness", ""), ("", "witness.invalid")):
                    host = re.sub(r"\.{2,}", ".", prefix + raw + suffix)
                    if audit.valid_host(host):
                        critical.update(audit.domain_boundaries(host))
                        try:
                            ipaddress.ip_address(host)
                            ip_literals.add(host)
                        except ValueError:
                            pass
        rng = random.Random(20261121)
        for rule in rng.sample(sorted(original), min(4000, len(original))):
            critical.update(audit.domain_boundaries(rule[2:] if rule.startswith("+.") else rule))
        for index in range(8000):
            critical.add("c" + str(index) + ".negative.union-check.invalid")
        critical.update(("doubleclick.net", "www3.doubleclick.net", "pixel.wp.pl", "clean.union-regression.invalid"))
        hosts.update(critical)
        hosts = {host for host in hosts if audit.valid_host(host)}
        critical = {host for host in critical if audit.valid_host(host)}
        counts = collections.Counter()
        residual_examples, decisions = [], {}
        for number, host in enumerate(sorted(hosts), 1):
            source_match = original_policy(host)
            target_match = merged_policy(host)
            if source_match != target_match:
                raise AssertionError(("Offline policy changed", host, source_match, target_match))
            counts["hostnames"] += 1
            counts["uppercase_hostnames" if host != host.lower() else "canonical_hostnames"] += 1
            counts["blocked" if source_match else "fallthrough"] += 1
            if not target_index(host) and source_match:
                counts["needs_supplement"] += 1
                if len(residual_examples) < 12:
                    residual_examples.append(host)
            if host in critical:
                decisions[host] = "blocked" if source_match else "fallthrough"
            if number % 150000 == 0:
                print("Offline hostnames: " + str(number) + "/" + str(len(hosts)), flush=True)
        if merged_extra and not residual_examples:
            raise AssertionError("No runtime witness demonstrates why the supplement is required")
        print("Offline equivalence: " + json.dumps(dict(counts)), flush=True)
        live = set(rng.sample(sorted(hosts), min(4000, len(hosts))))
        live.update(rng.sample(sorted(critical), min(11000, len(critical))))
        live.update(ip_literals)
        live.update(residual_examples)
        live.update(migration_hosts)
        live.update(("doubleclick.net", "www3.doubleclick.net", "pixel.wp.pl", "clean.union-regression.invalid"))
        # Ensure allow conditions and important-origin rules are represented.
        for leaf in all_leaves:
            kind, value = leaf.split(",", 1)
            if kind in ("DOMAIN", "DOMAIN-SUFFIX"):
                live.update(audit.domain_boundaries(value))
        live = sorted(host for host in live if audit.valid_host(host))
        expected = {}
        for host in live:
            try:
                ipaddress.ip_address(host)
            except ValueError:
                expected[host] = decisions.get(host, "blocked" if original_policy(host) else "fallthrough")
        partial = {"generated_at_utc": datetime.now(timezone.utc).isoformat(),
              "core_version": build["core_version"], "source_unique_domain_clauses_checked": len(original),
              "false_positive_exclusions": sorted(exclusions),
              "local_domain_entries_checked": len(local_domains),
              "uncovered_source_clauses": 0, "unjustified_output_clauses": 0,
              "mrs_roundtrip_rules": len(merged), "extra_rules": len(merged_extra),
              "offline": {**dict(counts), "differences": 0, "regexes_exercised": regex_count},
              "supplement_required_examples": residual_examples,
              "limitations": ["Equivalence is against the saved seven MRS snapshots, reviewed local domains and the saved AdGuard companion, minus reviewed false-positive suffixes, used together with REJECT.",
                              "IP-literal proxy targets use different core metadata than DNS hostnames; their runtime checks compare source and merged routing directly.",
                              "Tests do not assess live advertising effectiveness or upstream false-positive rates; no external requests were forwarded."],
              "offline_elapsed_seconds": round(time.monotonic() - started, 3)}
        (ROOT / "validation-cases.json").write_text(json.dumps({"output_hashes": {name: data["sha256"] for name, data in build["files"].items()},
            "manifest_sha256": build["input_manifest_sha256"], "hosts": live, "expected": expected, "partial_report": partial}, ensure_ascii=False, indent=2) + "\n")
        runtime = run_cores(core, manifest, len(merged), len(merged_extra), live, expected, temp, exclusions)
    finish(partial, runtime, build, started)


def finish(partial, runtime, build, started):
    result = {**partial, "runtime": runtime, "elapsed_seconds": round(time.monotonic() - started, 3)}
    (ROOT / "test-report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    build["validation"] = {"report": "test-report.json", "offline_differences": 0,
                           "runtime_differences": 0, "runtime_oracle_errors": 0, "transport_errors": 0}
    (ROOT / "build-report.json").write_text(json.dumps(build, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
