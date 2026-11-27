"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "../module/reddit");
const source = fs.readFileSync(path.join(root, "reddit-adblock.js"), "utf8");

function run(body, options = {}) {
    let calls = 0, result;
    const logs = [];
    const response = { status: 200, body: typeof body === "string" ? body : JSON.stringify(body), ...options.response };
    const before = JSON.stringify(response);
    vm.runInNewContext(source, {
        $request: { url: options.url || "https://gql-fed.reddit.com/", method: "POST" },
        $response: response,
        $argument: options.argument,
        console: { log: message => logs.push(message) },
        $done(value) { calls++; result = JSON.parse(JSON.stringify(value)); }
    }, { timeout: 1000 });
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(response), before);
    return { result, body: result.body ? JSON.parse(result.body) : body, logs };
}

const normal = { cursor: "KEEP_CURSOR", node: { __typename: "Post", title: "advice about advertising", isNsfw: true } };
const ad = { cursor: "AD_CURSOR", node: { __typename: "AdPost" } };
const sduiAd = { node: { __typename: "FeedItem", cells: [{ __typename: "AdMetadataCell" }, { __typename: "PostCell" }] } };
const unknown = { node: { __typename: "FuturePost", cells: [{ __typename: "AdAdviceCell" }], ad: true } };

test("all documented feed roots filter explicit ad entries and preserve cursors, errors and account flags", () => {
    for (const key of ["homeV3", "subredditV3", "popularV3", "newsV3", "home"]) {
        const elements = { edges: [normal, ad, sduiAd, unknown, null, { node: null }],
            pageInfo: { endCursor: "KEEP_NEXT", hasNextPage: true }, next: "KEEP_NEXT" };
        const body = { data: { [key]: { elements }, viewer: { isPremium: false, nsfw: true } },
            errors: [{ message: "KEEP_ERROR" }], extensions: { keep: true } };
        const output = run(body);
        assert.deepEqual(output.body, { ...body, data: { ...body.data,
            [key]: { elements: { ...elements, edges: [normal, unknown, null, { node: null }] } } } });
        assert.match(output.logs[0], /信息流 2 条/);
    }
});

test("comment ads are cleared without touching comments, post body or adjacent fields", () => {
    const post = { id: "KEEP_ID", comments: [{ body: "KEEP_COMMENT" }],
        pdpCommentsAds: { adPosts: [{ id: "ad1" }, { id: "ad2" }], experiment: "KEEP_EXPERIMENT" } };
    const body = { data: { postInfoById: post, unknown: { __typename: "AdPost" } } };
    assert.deepEqual(run(body).body, { data: { ...body.data,
        postInfoById: { ...post, pdpCommentsAds: { ...post.pdpCommentsAds, adPosts: [] } } } });
});

test("batched GraphQL responses keep order, errors and non-ad operations", () => {
    const body = [{ data: { home: { elements: { edges: [normal, ad] } } } },
        { errors: [{ message: "keep" }], data: null },
        { data: { postInfoById: { pdpCommentsAds: { adPosts: [ad] }, comments: [] } } }];
    const output = run(body).body;
    assert.equal(output.length, 3);
    assert.deepEqual(output[0].data.home.elements.edges, [normal]);
    assert.deepEqual(output[1], body[1]);
    assert.deepEqual(output[2].data.postInfoById.pdpCommentsAds.adPosts, []);
});

test("unknown and malformed shapes, no-ad feeds and non-JSON pass through without reserializing", () => {
    const samples = ["{broken", "<html>Forbidden</html>", "", "null", "42",
        { data: { home: { elements: { edges: [normal, unknown] } } } },
        { data: { homeV3: { elements: { edges: null } }, postInfoById: null } },
        { data: { futureFeed: { elements: { edges: [ad] } } } },
        { data: { postInfoById: { pdpCommentsAds: { adPosts: [] } } } },
        { data: null, errors: [{ message: "private error" }] }];
    for (const sample of samples) assert.deepEqual(run(sample).result, {});
});

test("only root GraphQL endpoints on the two known hosts can be changed", () => {
    const body = { data: { home: { elements: { edges: [ad] } } } };
    for (const url of ["https://gql.reddit.com/", "https://gql-fed.reddit.com:443/?token=PRIVATE"]) {
        assert.deepEqual(run(body, { url }).body.data.home.elements.edges, []);
    }
    for (const url of ["https://gql.reddit.com.evil.test/", "https://www.reddit.com/",
        "https://gql.reddit.com/unknown", "https://gql.reddit.com:8443/", "http://gql.reddit.com/"]) {
        assert.deepEqual(run(body, { url }).result, {});
    }
    for (const status of [301, 403, 429, 500]) assert.deepEqual(run(body, { response: { status } }).result, {});
    assert.deepEqual(run(body, { response: { statusCode: 403 } }).result, {});
});

test("all-ad pages retain pagination and debug can be disabled", () => {
    const body = { data: { home: { elements: { edges: [ad], pageInfo: { endCursor: "next", hasNextPage: true } } } } };
    const output = run(body, { argument: "debug=false" });
    assert.deepEqual(output.body.data.home.elements, { edges: [], pageInfo: body.data.home.elements.pageInfo });
    assert.deepEqual(output.logs, []);
});

test("modules match root endpoints and reference the existing remote/local download scheme", () => {
    for (const name of ["adblock", "capture"]) {
        const manifest = fs.readFileSync(path.join(root, `reddit-${name}.sgmodule`), "utf8");
        const line = manifest.split("\n").find(line => line.includes(" = type=http-response,"));
        const pattern = new RegExp(line.match(/, pattern=(.*?), requires-body=/)[1]);
        assert.ok(pattern.test("https://gql-fed.reddit.com/?query=x"));
        assert.ok(pattern.test("https://gql.reddit.com:443/"));
        assert.equal(pattern.test("https://gql-fed.reddit.com.evil.test/"), false);
        assert.equal(pattern.test("https://gql-fed.reddit.com/unknown"), false);
        assert.ok(line.includes(`script-path=https://raw.githubusercontent.com/s20210117/vpn-config/main/module/reddit/reddit-${name}.js`));
        assert.doesNotMatch(manifest, /\[Rule\]|\[URL Rewrite\]|hostname\s*=.*\*/);
    }
});
