#!/usr/bin/env python3
"""Build one domain MRS plus any necessary classical supplement from snapshots.

Python 3.9+, standard library only. Usage: python3 build_merged.py /path/to/mihomo
The only files written are inside this project; no client settings are changed.
"""
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict
import hashlib
import ipaddress
import json
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent


def payload(file):
    return [json.loads(line[4:]) for line in file.read_text().splitlines() if line.startswith("  - ")]


def parent_names(host):
    labels = host.split(".")
    return [".".join(labels[offset:]) for offset in range(len(labels))]


def minimize_domains(entries):
    suffixes = {value[2:] for value in entries if value.startswith("+.")}
    exact = entries - {"+." + value for value in suffixes}
    roots = {value for value in suffixes if not any(parent in suffixes for parent in parent_names(value)[1:])}
    exact = {value for value in exact if not any(parent in suffixes for parent in parent_names(value))}
    return {"+." + value for value in roots} | exact


def parse(expression):
    kind, value = expression.split(",", 1)
    if kind not in ("AND", "OR", "NOT"):
        if kind not in ("DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-REGEX"):
            raise ValueError("Unsupported classical rule: " + kind)
        return kind, value
    if not value.startswith("(") or not value.endswith(")"):
        raise ValueError(expression)
    body = value[1:-1]
    children, depth, start = [], 0, None
    escaped, character_class = False, False
    for index, char in enumerate(body):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "[":
            character_class = True
        elif char == "]":
            character_class = False
        if character_class:
            continue
        if char == "(":
            if depth == 0:
                start = index + 1
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                children.append(parse(body[start:index]))
        elif depth == 0 and char != ",":
            raise ValueError(expression)
        if depth < 0:
            raise ValueError(expression)
    if depth or not children or (kind == "NOT" and len(children) != 1):
        raise ValueError(expression)
    return kind, tuple(children)


def render(node):
    kind, value = node
    if kind not in ("AND", "OR", "NOT"):
        return kind + "," + value
    return kind + ",(" + ",".join("(" + render(child) + ")" for child in value) + ")"


def fixed_regex_domain(pattern):
    """Only exact, case-insensitive literal hostname regexes can be lifted."""
    if not pattern.startswith("(?i)"):
        return None
    body = pattern[4:]
    if body.startswith(r"(^|\.)"):
        kind, body = "DOMAIN-SUFFIX", body[len(r"(^|\.)"):]
    elif body.startswith("^"):
        kind, body = "DOMAIN", body[1:]
    else:
        return None
    if not body.endswith("$"):
        return None
    body = body[:-1]
    if not re.fullmatch(r"(?:\\[.\-_]|[A-Za-z0-9_-])+", body):
        return None
    name = re.sub(r"\\([.\-_])", r"\1", body).lower()
    # Retain IP-shaped hostname regexes as classical predicates. Turning a
    # hostname predicate into a provider entry must not change the distinction
    # between Host and DstIP metadata on IP-literal proxy requests.
    try:
        ipaddress.ip_address(name)
        return None
    except ValueError:
        pass
    if "." not in name or not all(re.fullmatch(r"[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?", label) for label in name.split(".")):
        return None
    return ("+." if kind == "DOMAIN-SUFFIX" else "") + name


def regex_suffix_envelope(pattern):
    """Conservative whole-label suffix required by a simple anchored regex.

    Alternation and character classes remain unknown. The first literal label
    is discarded because an adjacent wildcard could start inside that label.
    """
    body = pattern[4:] if pattern.startswith("(?i)") else pattern
    if not body.endswith("$"):
        return None
    body = body[:-1]
    if body.startswith(r"(^|\.)"):
        body = body[len(r"(^|\.)"):]
    elif body.startswith("^"):
        body = body[1:]
    if not re.fullmatch(r"(?:\\[.\-_]|[A-Za-z0-9_-]|\.\*)+", body):
        return None
    tail = []
    for token in reversed(re.findall(r"\\.|.", body)):
        if re.fullmatch(r"[A-Za-z0-9_-]", token):
            tail.append(token)
        elif token in (r"\.", r"\-", r"\_"):
            tail.append(token[1:])
        else:
            break
    literal = "".join(reversed(tail)).lower()
    return literal.split(".", 1)[1] if "." in literal else None


class Residual:
    """Simplify the classical rule under the condition that MRS did not match.

    If atom A is wholly covered by domain union D, then outside D, A is false.
    Thus D OR F == D OR F[A := false]. Boolean simplification preserves NOT,
    including allow conditions. It never creates a global allow policy.
    """
    def __init__(self, domains):
        self.suffixes = {value[2:] for value in domains if value.startswith("+.")}
        self.exact = {value for value in domains if not value.startswith("+.")}
        self.proofs = {}
        self.cache = {}

    def covering(self, name, exact=False):
        for parent in parent_names(name.lower()):
            if parent in self.suffixes:
                return "+." + parent
        if exact and name.lower() in self.exact:
            return name.lower()
        return None

    def atom_proof(self, node):
        kind, value = node
        if kind in ("DOMAIN", "DOMAIN-SUFFIX"):
            return self.covering(value, kind == "DOMAIN")
        fixed = fixed_regex_domain(value)
        if fixed is not None:
            return self.covering(fixed[2:] if fixed.startswith("+.") else fixed,
                                 exact=not fixed.startswith("+."))
        envelope = regex_suffix_envelope(value)
        return self.covering(envelope) if envelope else None

    def simplify(self, node):
        if node in self.cache:
            return self.cache[node]
        kind, value = node
        if kind not in ("AND", "OR", "NOT"):
            proof = self.atom_proof(node)
            if proof:
                self.proofs[render(node)] = proof
                result = False
            else:
                result = node
        else:
            children = [self.simplify(child) for child in value]
            if kind == "NOT":
                child = children[0]
                result = not child if isinstance(child, bool) else (kind, (child,))
            elif kind == "AND" and False in children:
                result = False
            elif kind == "OR" and True in children:
                result = True
            else:
                identity = kind == "AND"
                children = sorted({child for child in children if child is not identity}, key=render)
                if not children:
                    result = identity
                elif len(children) == 1:
                    result = children[0]
                else:
                    result = kind, tuple(children)
        self.cache[node] = result
        return result


def factor_shared_exceptions(expressions):
    """Factor OR((A AND C), (B AND C)) into (OR(A,B) AND C).

    All inputs are pure hostname predicates. Group only identical NOT
    conditions, preserving every positive branch and its original exceptions.
    """
    groups, result = defaultdict(set), set()
    for expression in expressions:
        node = parse(expression)
        if node[0] == "AND":
            positive = [child for child in node[1] if child[0] != "NOT"]
            negative = tuple(child for child in node[1] if child[0] == "NOT")
            if len(positive) == 1 and negative:
                groups[negative].add(positive[0])
                continue
        result.add(node)
    grouping = []
    for negative, branches in groups.items():
        ordered = tuple(sorted(branches, key=render))
        positive = ordered[0] if len(ordered) == 1 else ("OR", ordered)
        result.add(("AND", (positive,) + negative))
        if len(ordered) > 1:
            grouping.append({"positive_branches": len(ordered),
                             "shared_conditions": [render(child) for child in negative]})
    return sorted(render(node) for node in result), grouping


def main():
    core = str(Path(sys.argv[1]).resolve())
    manifest = json.loads((ROOT / "inputs/manifest.json").read_text())
    for name in ("test-report.json", "runtime-results.json", "validation.log", "validation-cases.json"):
        (ROOT / name).unlink(missing_ok=True)
    source_domains, source_counts = set(), {}
    extra_info = manifest["adguard_extra"]
    extra_file = ROOT / "inputs" / extra_info["file"]
    if hashlib.sha256(extra_file.read_bytes()).hexdigest() != extra_info["sha256"]:
        raise AssertionError("AdGuard input checksum changed")
    source_extras = payload(extra_file)
    if len(source_extras) != extra_info["rules"]:
        raise AssertionError("AdGuard input count changed")
    trees = [parse(expression) for expression in source_extras]
    with tempfile.TemporaryDirectory(prefix="merged-rules-build-") as temp:
        temp = Path(temp)
        for name, info in manifest["domain_providers"].items():
            source = ROOT / "inputs" / info["file"]
            if hashlib.sha256(source.read_bytes()).hexdigest() != info["sha256"]:
                raise AssertionError("Input checksum changed: " + name)
            decoded = temp / (name + ".txt")
            subprocess.run([core, "convert-ruleset", "domain", "mrs", str(source), str(decoded)], check=True)
            lines = decoded.read_text().splitlines()
            if len(lines) != info["rules"] or len(lines) != len(set(lines)):
                raise AssertionError("Source MRS count changed: " + name)
            if any(not line or any(char in line for char in "*?,/") or "+" in line.removeprefix("+.") for line in lines):
                raise ValueError("Unsupported domain syntax in " + name)
            source_counts[name] = len(lines)
            source_domains.update(lines)
        domains = minimize_domains(source_domains)
        initial_domain_count = len(domains)
        promoted = {}
        for iteration in range(20):
            residual = Residual(domains)
            simplified = [residual.simplify(tree) for tree in trees]
            promote = set()
            for original, node in zip(source_extras, simplified):
                if node is True:
                    raise ValueError("Unexpected universal block in the residual policy")
                if node is not False and node[0] == "DOMAIN-REGEX":
                    domain = fixed_regex_domain(node[1])
                    if domain is not None:
                        promote.add(domain)
                        promoted[original] = domain
            if not promote:
                break
            domains = minimize_domains(domains | promote)
        else:
            raise RuntimeError("Domain promotion did not converge")
        residual_extras = sorted({render(node) for node in simplified if node is not False})
        extras, shared_groups = factor_shared_exceptions(residual_extras)
        statuses = [{"input_index": index, "status": "covered_by_mrs" if node is False else
                     ("unchanged" if render(node) == original else "simplified"),
                     "residual_sha256": hashlib.sha256(render(node).encode()).hexdigest() if node is not False else None}
                    for index, (original, node) in enumerate(zip(source_extras, simplified))]
        yaml = temp / "domains.yaml"
        yaml.write_text("payload:\n" + "".join("  - " + json.dumps(value) + "\n" for value in sorted(domains)))
        target = temp / "ads-merged.mrs"
        subprocess.run([core, "convert-ruleset", "domain", "yaml", str(yaml), str(target)], check=True)
        decoded = temp / "output.txt"
        subprocess.run([core, "convert-ruleset", "domain", "mrs", str(target), str(decoded)], check=True)
        if set(decoded.read_text().splitlines()) != domains:
            raise AssertionError("Merged MRS roundtrip changed normalized entries")
        (ROOT / "ads-merged.mrs").write_bytes(target.read_bytes())
    headers = ["# Required companion to ads-merged.mrs; preserve both REJECT providers.",
               "# Simplified under the condition that the merged domain MRS did not match.",
               "# See build-report.json and README.md for scope and provenance."]
    (ROOT / "ads-merged-extra.yaml").write_text("\n".join(headers) + "\n" +
        ("payload:\n" + "".join("  - " + json.dumps(rule) + "\n" for rule in extras) if extras else "payload: []\n"))
    config = ["# Merge these providers and rules into your existing mihomo profile.",
              "# Copy the two rule files to <mihomo HomeDir>/rules/merged/.",
              "rule-providers:", "  ads-merged:", "    type: file", "    behavior: domain", "    format: mrs",
              "    path: ./rules/merged/ads-merged.mrs"]
    if extras:
        config += ["  ads-merged-extra:", "    type: file", "    behavior: classical", "    format: yaml",
                   "    path: ./rules/merged/ads-merged-extra.yaml"]
    config += ["", "rules:", "  - RULE-SET,ads-merged,REJECT"]
    if extras:
        config += ["  - RULE-SET,ads-merged-extra,REJECT"]
    config += ["  # Keep your existing routing rules after these entries."]
    (ROOT / "mihomo-example.yaml").write_text("\n".join(config) + "\n")
    result = {"generated_at_utc": datetime.now(timezone.utc).isoformat(),
              "core_version": subprocess.check_output([core, "-v"], text=True).strip(),
              "input_manifest_sha256": hashlib.sha256((ROOT / "inputs/manifest.json").read_bytes()).hexdigest(),
              "source_domain_counts": source_counts, "source_domain_records": sum(source_counts.values()),
              "source_unique_domain_entries": len(source_domains), "normalized_source_domain_entries": initial_domain_count,
              "merged_mrs_rules": len(domains), "promoted_regex_rules": promoted,
              "source_extra_rules": len(source_extras), "output_extra_rules": len(extras),
              "extra_rules_before_factoring": len(residual_extras),
              "factored_shared_exception_groups": shared_groups,
              "source_extra_bytes": extra_file.stat().st_size,
              "extra_source_dispositions": statuses, "covered_atom_proofs": residual.proofs,
              "semantics": ["Union of seven domain MRS providers plus the original AdGuard companion, all used with REJECT.",
                            "Only proved redundant domain scopes and proved redundant Boolean conditions are removed.",
                            "AdGuard exceptions remain local to its predicates; other lists can independently reject the same hostname.",
                            "Classical literals are not promoted to case-insensitive MRS entries; raw-host case behavior is preserved.",
                            "The supplement is a residual policy, designed to accompany this MRS; it is not a standalone AdGuard list.",
                            "Previously reviewed URL/port/path-only DNS-inapplicable source rules are not broadened into IP or domain matches."],
              "files": {name: {"bytes": (ROOT / name).stat().st_size,
                               "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest()}
                        for name in ("ads-merged.mrs", "ads-merged-extra.yaml")},
              "mrs_roundtrip": "Every normalized output entry equals the core-decoded entry.",
              "validation": "Run validate_merged.py after this build."}
    (ROOT / "build-report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: result[key] for key in ("source_domain_records", "source_unique_domain_entries", "normalized_source_domain_entries", "merged_mrs_rules", "promoted_regex_rules", "source_extra_rules", "output_extra_rules", "files")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
