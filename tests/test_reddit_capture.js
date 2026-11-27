"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../module/reddit/reddit-capture.js"), "utf8");

function run(body, options = {}) {
    const posts = [], logs = [], timers = new Map();
    let calls = 0, result, callback;
    const response = { status: 200, body: typeof body === "string" ? body : JSON.stringify(body), ...options.response };
    const before = JSON.stringify(response);
    const collector = options.collector === undefined ? "http://127.0.0.1:18769/capture" : options.collector;
    vm.runInNewContext(source, {
        $argument: "collector=" + encodeURIComponent(collector) + "&" + (options.argument || ""),
        $request: { url: options.url || "https://gql-fed.reddit.com/?token=PRIVATE_QUERY", method: "POST",
            headers: { Authorization: "PRIVATE_HEADER" }, body: '{"token":"PRIVATE_REQUEST"}' },
        $response: response,
        console: { log: message => logs.push(message) },
        $httpClient: { post(config, cb) {
            posts.push(JSON.parse(JSON.stringify(config)));
            callback = cb;
            if (!options.deferred) cb(options.error || null, { status: 204 });
        } },
        setTimeout(fn) { timers.set(1, fn); return 1; },
        clearTimeout(id) { timers.delete(id); },
        $done(value) { calls++; result = JSON.parse(JSON.stringify(value)); }
    }, { timeout: 1000 });
    if (options.deferred) {
        for (const timer of timers.values()) timer();
        if (callback) callback(null, { status: 204 });
    }
    assert.equal(calls, 1);
    assert.deepEqual(result, {});
    assert.equal(JSON.stringify(response), before);
    assert.equal(timers.size, 0);
    return { posts, logs };
}

test("diagnostics count GraphQL types without uploading request secrets or content values", () => {
    const output = run({ data: { homeV3: { elements: { edges: [
        { node: { __typename: "AdPost", title: "PRIVATE_TITLE", author: "PRIVATE_USER", id: "PRIVATE_ID" } },
        { node: { cells: [{ __typename: "AdMetadataCell" }], token: "PRIVATE_TOKEN" } }
    ] } } }, errors: [{ message: "PRIVATE_ERROR" }] });
    assert.equal(output.posts.length, 1);
    const record = JSON.parse(output.posts[0].body);
    assert.equal(record.request.url, "https://gql-fed.reddit.com/");
    assert.equal(record.structure.types.AdPost, 1);
    assert.equal(record.structure.types.AdMetadataCell, 1);
    assert.ok(record.structure.paths.includes("$.data.homeV3.elements.edges=array"));
    assert.ok(record.structure.arrays.some(item => item.path === "$.data.homeV3.elements.edges" && item.length === 2));
    assert.doesNotMatch(JSON.stringify(output), /PRIVATE_/);
});

test("captures only known hosts and keeps failures and non-JSON as metadata", () => {
    for (const url of ["https://gql.reddit.com/", "https://gql-fed.reddit.com:443/"]) {
        assert.equal(run({}, { url }).posts.length, 1);
    }
    for (const url of ["https://gql.reddit.com.evil.test/", "https://www.reddit.com/", "https://gql.reddit.com/unknown"]) {
        assert.equal(run({}, { url }).posts.length, 0);
    }
    const record = JSON.parse(run("<html>PRIVATE_ERROR</html>", { response: { status: 403 } }).posts[0].body);
    assert.equal(record.response.status, 403);
    assert.equal(record.response.format, "non-json");
    assert.deepEqual(record.structure.paths, []);
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE_ERROR/);
});

test("collector off still logs locally; debug=false suppresses logs while capturing", () => {
    for (const collector of ["off", "", "file:///tmp/capture"]) {
        const output = run({ data: {} }, { collector });
        assert.equal(output.posts.length, 0);
        assert.match(output.logs[0], /HTTP 200/);
    }
    const output = run({ data: {} }, { argument: "debug=false" });
    assert.equal(output.posts.length, 1);
    assert.deepEqual(output.logs, []);
});

test("receiver failures, timeout and a late callback always release the original response once", () => {
    assert.equal(run({ data: {} }, { error: "offline" }).posts.length, 1);
    assert.equal(run({ data: {} }, { deferred: true }).posts.length, 1);
});

test("large responses have bounded summaries and opaque object keys are redacted", () => {
    const output = run({ "12345678901234567890": { data: Array.from({ length: 20000 }, () => ({ __typename: "Post", title: "PRIVATE" })) } });
    const record = JSON.parse(output.posts[0].body);
    assert.equal(record.structure.truncated, true);
    assert.ok(record.structure.paths.length <= 800);
    assert.ok(record.structure.arrays.length <= 300);
    assert.doesNotMatch(JSON.stringify(record), /12345678901234567890|PRIVATE/);
});
