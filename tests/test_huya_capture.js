"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
    path.join(__dirname, "../module/huya/huya-capture.js"),
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

test("captures privacy-minimized structure and leaves the Huya response unchanged", () => {
    const output = run(
        "https://business.msstatic.com/advertiser/feed/123456?token=PRIVATE_QUERY",
        {
            data: [{
                type: "feed_advert",
                ad_info: { creative_id: "PRIVATE_CREATIVE" },
                title: "PRIVATE_TITLE",
                user: { uid: 123456, name: "PRIVATE_NAME" },
            }],
        },
    );
    assert.deepEqual(output.result, {});
    assert.equal(output.posts.length, 1);
    assert.equal(output.posts[0].url, "http://192.168.2.77:18768/capture");
    assert.equal(output.posts[0].headers["X-HUYA-Capture"], "v1");
    const record = JSON.parse(output.posts[0].body);
    assert.equal(record.request.url, "https://business.msstatic.com/advertiser/feed/:id");
    assert.match(JSON.stringify(record.structure), /feed_advert|ad_info/);
    assert.doesNotMatch(JSON.stringify(record), /123456|PRIVATE_/);
});

test("captures metadata for non-JSON and ignores failed, unrelated and lookalike responses", () => {
    const binary = run("https://business.msstatic.com/advertiser/config.bin", "BINARY", {
        response: { headers: { "Content-Type": "image/png" } },
    });
    assert.equal(binary.posts.length, 1);
    assert.equal(JSON.parse(binary.posts[0].body).structure.format, "non-json");
    assert.equal(run("https://business.msstatic.com/feed", { ad: true }, {
        response: { status: 503 },
    }).posts.length, 0);
    assert.equal(run("https://business.msstatic.com.evil.test/feed", { ad: true }).posts.length, 0);
    assert.equal(run("https://example.com/feed", { ad: true }).posts.length, 0);
});

test("captures third-party ad structures and lightweight material metadata", () => {
    const structured = run("https://us.l.qq.com/exapp?device=PRIVATE", {
        data: [{ ad_type: "splash", creative_id: "PRIVATE_CREATIVE" }],
    });
    assert.equal(structured.posts.length, 1);
    assert.match(structured.posts[0].body, /ad_type|splash/);

    const material = run(
        "https://pgdt.gtimg.cn/141/20204/private.webp?token=PRIVATE",
        "",
        { response: { headers: { "Content-Type": "image/webp", "Content-Length": "49802" } } },
    );
    const record = JSON.parse(material.posts[0].body);
    assert.equal(record.request.url, "https://pgdt.gtimg.cn/:id/:id/private.webp");
    assert.equal(record.response.contentLength, 49802);
    assert.equal(record.response.bodyCharacters, 0);
});

test("capture module covers Huya and msstatic JSON entrances", () => {
    const text = fs.readFileSync(
        path.join(__dirname, "../module/huya/huya-capture.sgmodule"),
        "utf8",
    );
    const lines = text.split(/\r?\n/).filter(item => item.includes("type=http-response"));
    assert.equal(lines.length, 2);
    const structurePattern = new RegExp(lines[0].match(/pattern=(.*?), requires-body/)[1]);
    const metadataPattern = new RegExp(lines[1].match(/pattern=(.*?), timeout=/)[1]);
    for (const url of [
        "https://business.msstatic.com/advertiser/material",
        "https://live-ads.huya.com/live/getAllEntrance",
        "https://dataservice.cdn.huya.com/recommend",
        "https://diy-front.cdn.huya.com/config",
        "https://df.huya.com/feature",
        "http://zt.huya.com/bootstrap",
        "https://us.l.qq.com/exapp",
        "https://tangram.e.qq.com/updateSetting",
        "https://api-access.pangolin-sdk-toutiao.com/api/ad/union/ping",
    ]) assert.ok(structurePattern.test(url), url);
    for (const url of [
        "https://pgdt.gtimg.cn/material.webp",
        "https://sf3-fe-tos.pglstatp-toutiao.com/renderer/index.js",
        "https://qn-livewebbs2pcdn.msstatic.com/splash.jpg",
        "http://cdnfile2.msstatic.com/candidate.bin",
        "https://s1-static.msstatic.com/candidate",
        "https://short.msstatic.com/candidate",
        "https://zt.msstatic.com/candidate",
        "https://cdnfile.huya.com/candidate",
    ]) assert.ok(metadataPattern.test(url), url);
    for (const pattern of [structurePattern, metadataPattern]) {
        assert.equal(pattern.test("http://cdn.wup.huya.com/launch/queryHttpDns"), false);
        assert.equal(pattern.test("https://api.huya.com/feed"), false);
        assert.equal(pattern.test("https://business.msstatic.com.evil.test/feed"), false);
    }
    assert.match(text, /^DOMAIN,us\.l\.qq\.com,DIRECT$/m);
    assert.match(text, /^DOMAIN,qn-livewebbs2pcdn\.msstatic\.com,DIRECT$/m);
    assert.match(text, /^#!version=1\.0\.5$/m);
    assert.match(text, /^#!date=2026-11-26$/m);
    assert.match(text, /^#!arguments=debug:true$/m);
});

test("debug=false suppresses logs without disabling capture", () => {
    const output = run(
        "https://business.msstatic.com/advertiser/feed",
        { data: [{ type: "feed_advert" }] },
        { argument: "debug=false" },
    );
    assert.equal(output.posts.length, 1);
    assert.deepEqual(output.logs, []);
});
