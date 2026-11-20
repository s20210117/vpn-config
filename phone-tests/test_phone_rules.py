#!/usr/bin/env python3
"""Check the phone's loaded ad rules without connecting to test websites.

Read the controller secret from stdin; never save it in the report.
"""

import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import ssl
import sys
from datetime import datetime, timezone
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parent
BUNDLE = ROOT.parent
HOST = "192.168.2.199"
PORT = 9443
FINGERPRINT = "07f7e3da7446b908d22a73eccea825338737dfd89944f1924edf9f36fdecb9be"
MRS = "local-353d1ae3-5a81-452c-8527-d56690c131dc"
YAML = "local-bee2aa81-babe-4bdb-929d-98894937deeb"


def make_cases():
    saved = json.loads((BUNDLE / "validation-cases.json").read_text())
    spec = importlib.util.spec_from_file_location("ad_test_support", BUNDLE / "test_support.py")
    support = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(support)
    expressions = support.read_payload("ads-merged-extra")
    predicates = [support.compile_expression(expression) for expression in expressions]
    witnesses = {}
    for host in saved["hosts"]:
        if saved["expected"].get(host) != "blocked":
            continue
        for index, predicate in enumerate(predicates):
            if index not in witnesses and predicate(host):
                witnesses[index] = host
    keys = sorted(witnesses)
    indices = [keys[round(i * (len(keys) - 1) / 23)] for i in range(24)]
    hosts = list(dict.fromkeys(witnesses[index] for index in indices))
    hosts += [
        "1024wanzhai.witness.invalid", "1024WANZHAI.WITNESS.INVALID",
        "1024wanzhai.witness.invalid.boundary.invalid", "adwolf.ru", "lhinsights.com",
        "doubleclick.net", "a.adwolf.ru", "unsubscribe.lhinsights.com",
        "cdn.atmedia.hu", "learn.khanacademy.org", "captcha.su.baidu.com",
    ]
    negatives = [host for host in saved["hosts"]
                 if saved["expected"].get(host) == "fallthrough" and "boundary.invalid" in host]
    hosts += negatives[:6]
    hosts = list(dict.fromkeys(hosts))
    for host in hosts:
        if host not in saved["expected"]:
            raise ValueError("No saved expectation for " + host)
    return [(host, network, saved["expected"][host])
            for host in hosts for network in ("tcp", "udp")]


def main():
    secret = sys.stdin.readline().rstrip("\r\n")
    if not secret:
        raise SystemExit("Read a controller secret from stdin.")
    connection = http.client.HTTPSConnection(
        HOST, PORT, context=ssl._create_unverified_context(), timeout=5)
    connection.connect()
    presented = hashlib.sha256(connection.sock.getpeercert(binary_form=True)).hexdigest()
    if presented != FINGERPRINT:
        connection.close()
        raise SystemExit("Certificate fingerprint mismatch; no secret sent.")

    def get(path):
        if connection.sock is None:
            connection.connect()
        certificate = connection.sock.getpeercert(binary_form=True)
        if hashlib.sha256(certificate).hexdigest() != FINGERPRINT:
            connection.close()
            raise RuntimeError("Certificate fingerprint mismatch; no secret sent.")
        connection.request("GET", path, headers={"Authorization": "Bearer " + secret})
        response = connection.getresponse()
        body = response.read()
        if response.status != 200:
            raise RuntimeError("Controller returned HTTP " + str(response.status))
        return json.loads(body)

    def counts(rules):
        return {rule["payload"]: rule.get("extra", {}).get("hitCount")
                for rule in rules.get("rules", []) if rule.get("payload") in (MRS, YAML)}

    version = get("/version")
    providers = get("/providers/rules")["providers"]
    before = counts(get("/rules"))
    cases = make_cases()
    results = []
    for host, network, expectation in cases:
        query = urlencode({"host": host, "network": network, "port": 443})
        reply = get("/clash/v1/rules/match?" + query)
        rule = reply.get("rule") or {}
        ad_match = rule.get("payload") in (MRS, YAML) and reply.get("proxy") == "REJECT"
        passed = bool(reply.get("decided")) and not reply.get("error") and (
            ad_match if expectation == "blocked" else not ad_match and reply.get("proxy") != "REJECT")
        results.append({
            "host": host, "network": network, "expected": expectation,
            "passed": passed, "rule": rule, "proxy": reply.get("proxy"),
            "chain": reply.get("chain"), "conditional": reply.get("conditional"),
            "missing": reply.get("missing"),
        })
        if len(results) % 20 == 0:
            print(json.dumps({"completed": len(results), "total": len(cases)}), flush=True)
    after = counts(get("/rules"))
    connection.close()
    summary = {
        "total": len(results), "passed": sum(result["passed"] for result in results),
        "failed": sum(not result["passed"] for result in results),
        "yaml_matches": sum(result["rule"].get("payload") == YAML for result in results),
        "mrs_matches": sum(result["rule"].get("payload") == MRS for result in results),
        "allowed_controls": sum(result["expected"] == "fallthrough" and result["passed"]
                                for result in results),
    }
    report = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(), "endpoint": f"https://{HOST}:{PORT}",
        "core_version": version, "test_type": "phone core rule explanation, no target connections or DNS resolution",
        "providers": {name: providers.get(name) for name in (MRS, YAML)},
        "hit_counts_before": before, "hit_counts_after": after,
        "summary": summary, "results": results,
        "limits": ["Synthetic matching verifies loaded rule behavior, not real advertising requests.",
                   "This core increments rule hit counters during rule explanation; test hits are not real ad requests."],
    }
    destination = ROOT / "report.json"
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"summary": summary, "hit_counts_before": before,
                      "hit_counts_after": after, "report": str(destination)}, ensure_ascii=False))
    raise SystemExit(0 if summary["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
