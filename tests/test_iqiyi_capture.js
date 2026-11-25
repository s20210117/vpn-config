"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../module/iqiyi/iqiyi-capture.js"), "utf8");

function run(url, body, options = {}) {
    let result;
    let calls = 0;
    const posts = [];
    const logs = [];
    vm.runInNewContext(source, {
        $request: { url, method: "GET", ...options.request },
        $response: {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: typeof body === "string" ? body : JSON.stringify(body),
            ...options.response,
        },
        $httpClient: {
            post: (request, callback) => {
                posts.push(JSON.parse(JSON.stringify(request)));
                callback(null, { status: 204 }, "");
            },
        },
        console: { log: value => logs.push(String(value)) },
        $argument: options.argument,
        setTimeout,
        clearTimeout,
        $done: value => { calls += 1; result = JSON.parse(JSON.stringify(value)); },
    }, { timeout: 1000 });
    assert.equal(calls, 1);
    return { result, posts, logs };
}

test("captures sanitized structure and leaves the response unchanged", () => {
    const output = run(
        "https://api.iqiyi.com/feed?token=PRIVATE_QUERY",
        {
            data: {
                cards: [
                    { alias_name: "ad_mobile_flow", ad_id: "ad-42", title: "private title" },
                    { alias_name: "film", user_token: "PRIVATE_BODY", title: "normal" },
                ],
            },
        },
    );
    assert.deepEqual(output.result, {});
    assert.equal(output.posts.length, 1);
    const record = JSON.parse(output.posts[0].body);
    assert.equal(record.request.url, "https://api.iqiyi.com/feed");
    assert.match(JSON.stringify(record.structure), /ad_mobile_flow|ad-42|alias_name/);
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE_QUERY|PRIVATE_BODY|private title|normal/);
    assert.equal(output.posts[0].url, "http://192.168.2.77:18766/capture");
});

test("ignores non-JSON, failed and unrelated responses", () => {
    assert.equal(run("https://api.iqiyi.com/image", "PNG", {
        response: { headers: { "Content-Type": "image/png" } },
    }).posts.length, 0);
    assert.equal(run("https://api.iqiyi.com/feed", { ad: true }, {
        response: { status: 503 },
    }).posts.length, 0);
    assert.equal(run("https://api.iqiyi.com.evil.test/feed", { ad: true }).posts.length, 0);
});

test("capture module covers API, nested and observed address entrances", () => {
    const moduleText = fs.readFileSync(path.join(__dirname, "../module/iqiyi/iqiyi-capture.sgmodule"), "utf8");
    const patterns = moduleText.split(/\r?\n/)
        .filter(line => line.includes("type=http-response"))
        .map(line => new RegExp(line.match(/pattern=(.*?), requires-body/)[1]));
    for (const url of [
        "https://api.iqiyi.com/feed",
        "https://t7z.cupid.iqiyi.com/mixer",
        "http://59.39.2.11/views_home/3.0/qy_home",
    ]) {
        assert.ok(patterns.some(pattern => pattern.test(url)), url);
    }
    assert.match(moduleText, /^#!type=$/m);
    assert.match(moduleText, /^#!version=1\.0\.2$/m);
    assert.match(moduleText, /^#!date=2026-11-25$/m);
    assert.match(moduleText, /^#!tag=爱奇艺抓广告诊断$/m);
    assert.match(moduleText, /^#!category=调试$/m);
    assert.match(moduleText, /^#!arguments=debug:true$/m);
    assert.match(moduleText, /^#!arguments-desc=debug：日志开关，true 开启，false 关闭。$/m);
    assert.equal(moduleText.match(/argument=debug=\{\{\{debug\}\}\}/g).length, 3);
});

test("debug=false suppresses logs without disabling capture", () => {
    const output = run("https://api.iqiyi.com/feed", { ad_id: "ad-1" }, { argument: "debug=false" });
    assert.equal(output.posts.length, 1);
    assert.deepEqual(output.logs, []);
});
