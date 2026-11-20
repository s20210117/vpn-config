#!/usr/bin/env python3
"""Extended offline equivalence, randomized fixtures, and live mihomo routing.

Uses the saved snapshots only. Usage: python3 test_merge_extended.py /path/to/mihomo
"""
from pathlib import Path
from datetime import datetime, timezone
import collections
import hashlib
import importlib.util
import ipaddress
import json
import random
import re
import sre_parse
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent


def read_payload(name):
    return [json.loads(line[4:]) for line in (ROOT / (name + ".yaml")).read_text().splitlines()
            if line.startswith("  - ")]


def logical_children(expression):
    """Read parenthesized arguments independently of the converter's writer."""
    outer = expression.split(",", 1)[1]
    if not outer.startswith("(") or not outer.endswith(")"):
        raise ValueError(expression)
    body, children, depth, start = outer[1:-1], [], 0, None
    for index, char in enumerate(body):
        if char == "(":
            if depth == 0:
                start = index + 1
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                children.append(body[start:index])
        elif depth == 0 and char != ",":
            raise ValueError(expression)
        if depth < 0:
            raise ValueError(expression)
    if depth != 0:
        raise ValueError(expression)
    return children


def compile_expression(expression):
    kind, value = expression.split(",", 1)
    if kind == "DOMAIN":
        return lambda host: host == value
    if kind == "DOMAIN-SUFFIX":
        return lambda host: host == value or host.endswith("." + value)
    if kind == "DOMAIN-REGEX":
        pattern = re.compile(value)
        return lambda host: pattern.search(host) is not None
    children = [compile_expression(child) for child in logical_children(expression)]
    if kind == "NOT" and len(children) == 1:
        return lambda host: not children[0](host)
    if kind == "AND":
        return lambda host: all(child(host) for child in children)
    if kind == "OR":
        return lambda host: any(child(host) for child in children)
    raise ValueError(expression)


class Matcher:
    """Indexed domain sets plus independently parsed regex/logical predicates."""
    def __init__(self, rules):
        self.exact, self.suffix, self.other = set(), set(), []
        for rule in rules:
            kind, value = rule.split(",", 1)
            if kind == "DOMAIN":
                self.exact.add(value)
            elif kind == "DOMAIN-SUFFIX":
                self.suffix.add(value)
            else:
                self.other.append(compile_expression(rule))

    def __call__(self, host):
        if host in self.exact:
            return True
        labels = host.split(".")
        if any(".".join(labels[index:]) in self.suffix for index in range(len(labels))):
            return True
        return any(predicate(host) for predicate in self.other)


def reference_matcher(groups):
    block, allow, important = (Matcher(groups[name]) for name in ("block", "allow", "important"))
    return lambda host: important(host) or (block(host) and not allow(host))


def regex_witness(pattern, variant):
    """Generate several positive examples from Python's parsed regex grammar."""
    rng = random.Random(variant)

    def category(value):
        if value in (sre_parse.CATEGORY_DIGIT, sre_parse.CATEGORY_UNI_DIGIT):
            return str(variant % 10)
        if value in (sre_parse.CATEGORY_WORD, sre_parse.CATEGORY_UNI_WORD):
            return "x"
        return "a"

    def emit(tokens):
        text = []
        for op, value in tokens:
            if op == sre_parse.LITERAL:
                text.append(chr(value))
            elif op == sre_parse.ANY:
                text.append("x" if variant % 3 else ".")
            elif op == sre_parse.AT:
                pass
            elif op == sre_parse.SUBPATTERN:
                text.append(emit(value[-1]))
            elif op == sre_parse.BRANCH:
                branches = value[1]
                text.append(emit(branches[variant % len(branches)]))
            elif op in (sre_parse.MAX_REPEAT, sre_parse.MIN_REPEAT):
                low, high, child = value
                # Exercise empty, one character, multiple characters and dots
                # for '*' without expanding unbounded repetitions.
                count = min(high, low + (variant % 4))
                text.append("".join(emit(child) for _ in range(count)))
            elif op == sre_parse.IN:
                candidates = []
                for item_op, item in value:
                    if item_op == sre_parse.LITERAL:
                        candidates.append(chr(item))
                    elif item_op == sre_parse.RANGE:
                        candidates.append(chr(rng.randint(item[0], item[1])))
                    elif item_op == sre_parse.CATEGORY:
                        candidates.append(category(item))
                    else:
                        raise ValueError((op, value))
                text.append(candidates[variant % len(candidates)])
            elif op == sre_parse.CATEGORY:
                text.append(category(value))
            else:
                raise ValueError((op, value))
        return "".join(text)

    witness = emit(sre_parse.parse(pattern))
    if re.search(pattern, witness) is None:
        raise AssertionError((pattern, witness))
    return witness


def valid_host(host):
    return (0 < len(host) <= 253 and "." in host and
            all(re.fullmatch(r"[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?", label)
                for label in host.split(".")))


def domain_boundaries(host):
    return (host, "x." + host, "x.y." + host, "x" + host,
            host + ".boundary.invalid", host.upper())

