"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
    path.join(__dirname, "../module/zhihu/zhihu-capture.js"),
    "utf8",
);

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
        $done: value => {
            calls += 1;
            result = JSON.parse(JSON.stringify(value));
        },
    }, { timeout: 1000 });
    assert.equal(calls, 1);
    return { result, posts, logs };
}

test("captures privacy-minimized structure and leaves the Zhihu response unchanged", () => {
    const output = run(
        "https://api.zhihu.com/questions/987654321/feeds?token=PRIVATE_QUERY",
        {
            data: {
                items: [
                    {
                        type: "feed_advert",
                        content_type: "promotion",
                        ad_info: { creative_id: "PRIVATE_CREATIVE_ID" },
                        target: {
                            id: 987654321,
                            title: "PRIVATE_TITLE",
                            content: "PRIVATE_CONTENT",
                            author: { name: "PRIVATE_AUTHOR", user_token: "PRIVATE_BODY_TOKEN" },
                        },
                    },
                    { type: "answer", content_type: "answer", title: "PRIVATE_NORMAL_TITLE" },
                ],
                by_user: { "987654321": { type: "ad" } },
            },
        },
    );
    assert.deepEqual(output.result, {});
    assert.equal(output.posts.length, 1);
    assert.equal(output.posts[0].url, "http://192.168.2.77:18767/capture");
    assert.equal(output.posts[0].headers["X-ZHIHU-Capture"], "v1");

    const record = JSON.parse(output.posts[0].body);
    assert.equal(record.request.url, "https://api.zhihu.com/questions/:id/feeds");
    assert.match(JSON.stringify(record.structure), /feed_advert|promotion|ad_info|:key/);
    assert.doesNotMatch(
        JSON.stringify(record),
        /987654321|PRIVATE_|PRIVATE_QUERY|PRIVATE_TITLE|PRIVATE_CONTENT|PRIVATE_AUTHOR/,
    );
});

test("ignores non-JSON, failed, unrelated and lookalike responses", () => {
    assert.equal(run("https://api.zhihu.com/image", "PNG", {
        response: { headers: { "Content-Type": "image/png" } },
    }).posts.length, 0);
    assert.equal(run("https://api.zhihu.com/topstory/recommend", { ad: true }, {
        response: { status: 503 },
    }).posts.length, 0);
    assert.equal(run("https://api.zhihu.com.evil.test/topstory/recommend", { ad: true }).posts.length, 0);
    assert.equal(run("https://duga.zhihu.com/config", { ad: true }).posts.length, 0);
    assert.equal(run("https://43.242.197.211/", { ad: true }).posts.length, 0);
});

test("capture module covers broad Zhihu JSON entrances without narrowing to known paths", () => {
    const moduleText = fs.readFileSync(
        path.join(__dirname, "../module/zhihu/zhihu-capture.sgmodule"),
        "utf8",
    );
    const patterns = moduleText.split(/\r?\n/)
        .filter(line => line.includes("type=http-response"))
        .map(line => new RegExp(line.match(/pattern=(.*?), requires-body/)[1]));
    for (const url of [
        "https://api.zhihu.com/new/unknown/feed",
        "https://web-render.zhihu.com/topstory/recommend",
        "https://page-info.zhihu.com/answers/v2/1",
        "https://page-modular.zhihu.com/templates/v1",
        "https://www.zhihu.com/api/v4/questions/1",
        "https://zhihu.com/api/new",
    ]) {
        assert.ok(patterns.some(pattern => pattern.test(url)), url);
    }
    assert.equal(patterns.some(pattern => pattern.test(
        "https://api.zhihu.com.evil.test/new/unknown/feed",
    )), false);
    assert.match(moduleText, /^#!name=知乎抓广告诊断$/m);
    assert.match(moduleText, /^#!type=$/m);
    assert.match(moduleText, /^#!version=1\.0\.2$/m);
    assert.match(moduleText, /^#!date=2026-11-25$/m);
    assert.match(moduleText, /^#!category=调试$/m);
    assert.match(moduleText, /^#!arguments=debug:true$/m);
    assert.doesNotMatch(moduleText, /43\.242\.197\.211/);
    assert.equal(moduleText.match(/argument=debug=\{\{\{debug\}\}\}/g).length, 1);
});

test("debug=false suppresses logs without disabling capture", () => {
    const output = run(
        "https://api.zhihu.com/new/feed",
        { data: [{ type: "feed_advert" }] },
        { argument: "debug=false" },
    );
    assert.equal(output.posts.length, 1);
    assert.deepEqual(output.logs, []);
});

test("captures page-modular structures without broadening to unrelated hosts", () => {
    const output = run("https://page-modular.zhihu.com/templates/v1", {
        templates: [{ type: "ComponentCard", is_advertiser: true }],
    });
    assert.equal(output.posts.length, 1);
    const record = JSON.parse(output.posts[0].body);
    assert.equal(record.request.url, "https://page-modular.zhihu.com/templates/v1");
    assert.match(JSON.stringify(record.structure), /is_advertiser/);
});
