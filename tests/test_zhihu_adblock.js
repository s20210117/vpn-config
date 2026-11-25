"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const directory = path.join(__dirname, "../module/zhihu");
const source = fs.readFileSync(path.join(directory, "zhihu-adblock.js"), "utf8");
const manifest = fs.readFileSync(path.join(directory, "zhihu-adblock.sgmodule"), "utf8");
const subscription = fs.readFileSync(path.join(__dirname, "../subscription/config.yaml"), "utf8");
const declarations = manifest.split(/\r?\n/).filter(line => line.includes(" = type=http-response,"));
const patterns = declarations.map(line => new RegExp(line.match(/, pattern=(.*?), requires-body=/)[1]));
const rejects = manifest.split(/\r?\n/).filter(line => line.endsWith(" - reject-dict"))
    .map(line => new RegExp(line.slice(0, -" - reject-dict".length)));
const networkRules = manifest.match(/\[Rule\]\r?\n([\s\S]*?)\r?\n\r?\n\[URL Rewrite\]/)[1]
    .split(/\r?\n/).filter(Boolean);

function run(url, body, options = {}) {
    let calls = 0;
    let result;
    const response = {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: typeof body === "string" ? body : JSON.stringify(body),
        ...options.response
    };
    const before = JSON.stringify(response);
    vm.runInNewContext(source, {
        $request: { url, method: "GET", ...options.request },
        $response: response,
        $argument: options.argument,
        console: options.console || { log(message) {
            if (options.logs) options.logs.push(message);
        } },
        $done(value) {
            calls++;
            result = JSON.parse(JSON.stringify(value));
        }
    }, { filename: "zhihu-adblock.js", timeout: 1000 });
    assert.equal(calls, 1, "$done must be called exactly once");
    assert.equal(JSON.stringify(response), before, "the input response must remain intact");
    assert.deepEqual(Object.keys(result).filter(key => key !== "body"), []);
    return result;
}

function output(url, body, options) {
    const result = run(url, body, options);
    return result.body ? JSON.parse(result.body) : body;
}

const normal = [
    { id: "answer", type: "feed", target: { type: "answer", content: "正文提到广告、盐选推荐" } },
    { id: "article", type: "article" },
    { id: "video", type: "zvideo" },
    { id: "pin", type: "pin" },
    { id: "empty-ad", type: "feed", ad: null, ad_list: [], promotion_extra: false,
        adjson: "", extra: { promotion: null } },
    { id: "unknown", type: "future_card" },
    null
];

test("recommendations remove explicit adverts and preserve ordinary content and metadata", () => {
    const body = { data: [
        ...normal,
        { type: "market_card" }, { type: "feed_advert" }, { type: "ad" },
        { extra: { type: "SvipActivity" } }, { ad: {} }, { adjson: "{}" },
        { ad_list: [{}] }, { extra: { promotion: {} } },
        { promotion_extra: {} }, { ad_info: { data: { id: "advert" } } },
        { is_advertiser: true }
    ], paging: { next: "original", is_end: false }, vip_info: { is_vip: false } };
    for (const host of ["api", "web-render"]) {
        const result = output(`https://${host}.zhihu.com/topstory/recommend?limit=10`, body);
        assert.deepEqual(result, { ...body, data: normal });
    }
});

test("captured recommendation data and dataV1 arrays remove only explicit adverts", () => {
    const first = { type: "answer", id: "first" };
    const second = { type: "article", id: "second" };
    const body = {
        data: [first, { type: "feed_advert", ad: { creatives: [] } }],
        dataV1: [second, { type: "feed_advert", adjson: "captured" }],
        paging: { next: "keep" }
    };
    assert.deepEqual(output("https://api.zhihu.com/topstory/recommend", body), {
        data: [first],
        dataV1: [second],
        paging: body.paging
    });
});

test("hot lists retain unknown ordinary card types instead of using a content whitelist", () => {
    const body = { data: [{ type: "hot_list_feed" }, { type: "hot_list_feed_video" },
        { type: "future_hot_card" }, { type: "feed_advert" }] };
    assert.deepEqual(output("https://api.zhihu.com/topstory/hot-lists/total", body),
        { data: body.data.slice(0, 3) });
});

test("captured v2 everyone-seeing hot list filters nested explicit adverts only", () => {
    const ordinary = [
        { type: "hot_list_feed", target: { title_area: { text: "normal" } } },
        { type: "future_hot_card", metadata: { keep: true } }
    ];
    const body = {
        data: { data: [...ordinary, { type: "feed_advert", ad: { creatives: [] } }], cursor: "keep" },
        paging: { is_end: false }
    };
    const url = "https://api.zhihu.com/v2/topstory/hot-lists/everyone-seeing?personal_mix_board=1";
    assert.equal(patterns.filter(pattern => pattern.test(url)).length, 1);
    assert.deepEqual(output(url, body), {
        data: { data: ordinary, cursor: "keep" },
        paging: body.paging
    });
});

test("answer lists remove ad_info while retaining answer visibility and account fields", () => {
    const answer = { target: { type: "answer", is_visible: false, is_copyable: false,
        visible_only_to_author: true, author: { name: "原作者" } } };
    const body = { data: [answer], ad_info: { id: "advert" }, vip_info: { is_vip: false } };
    assert.deepEqual(output("https://api.zhihu.com/questions/123/feeds?offset=0", body),
        { data: [answer], vip_info: { is_vip: false } });
});

test("answer lists filter explicit adverts from both current feed arrays", () => {
    const answer = { type: "feed", target: { type: "answer" } };
    const body = {
        data: [answer, { type: "feed_advert" }, { is_advertiser: true }],
        dataV1: [answer, { ad: { ad_verb: "default" } }],
        paging: { is_end: false }
    };
    assert.deepEqual(output("https://api.zhihu.com/questions/123/feeds?show_detail=1", body), {
        data: [answer], dataV1: [answer], paging: body.paging
    });
});

test("captured QX answer-feed advert shape is removed without preserving its payload", () => {
    const answer = {
        type: "question_feed_card",
        target_type: "answer",
        target: { type: "answer", answer_type: "normal" }
    };
    const advertFromCapture = {
        position: 8,
        ad: {
            ad_verb: "PROMOTE_VIDEO_CARD",
            display_advertising_tag: true,
            creatives: [{ title: "captured advert" }]
        },
        adjson: "captured advert payload"
    };
    const body = {
        data: [answer, advertFromCapture],
        paging: { page: 1, is_end: false },
        session: { id: "keep" }
    };
    assert.deepEqual(output("https://api.zhihu.com/questions/123/feeds?show_detail=1", body), {
        data: [answer],
        paging: body.paging,
        session: body.session
    });
});

test("next-render removes marked adverts and retains other content types", () => {
    const answer = { type: "answer", biz_type_list: ["answer"] };
    const other = { type: "article", biz_type_list: ["article"] };
    const body = { data: [answer, other, { ad_info: { data: {} } }, { type: "ad" }, { adjson: "{}" }] };
    assert.deepEqual(output("https://api.zhihu.com/next-render?answer_id=1", body), { data: [answer, other] });
});

test("next-bff and next-data remove their explicit nested advert forms", () => {
    const keep = { type: "answer" };
    assert.deepEqual(output("https://api.zhihu.com/next-bff", { data: [
        keep,
        { origin_data: { type: "feed_advert" } },
        { origin_data: { resource_type: "native_ad" } }
    ] }), { data: [keep] });
    assert.deepEqual(output("https://api.zhihu.com/next-data", {
        data: { data: [keep, { type: "feed_advert" }, { type: "native_ad" }], cursor: "keep" }
    }), { data: { data: [keep], cursor: "keep" } });
});

test("search suggestions remove commercial markers and retain ordinary query data", () => {
    const query = { query: "如何识别广告", ad_commercial_json: null };
    const body = { recommend_queries: { queries: [query, { query: "品牌推广", ad_commercial_json: "{}" }],
        tracking: "keep" }, other: "keep" };
    assert.deepEqual(output("https://api.zhihu.com/search/recommend_query", body),
        { ...body, recommend_queries: { ...body.recommend_queries, queries: [query] } });
});

test("captured preset words POST removes only the two explicit commercial markers", () => {
    const normalWords = [
        { type: "general", query: "普通搜索词" },
        { type: "general", query: "空广告字段", ad_commercial_json: null,
            preset_word_ad_commercial_json: "" }
    ];
    const body = {
        preset_words: {
            words: [
                ...normalWords,
                { type: "general", query: "广告一", ad_commercial_json: "{}" },
                { type: "general", query: "广告二", preset_word_ad_commercial_json: "{}" }
            ],
            NextRequestTs: 1
        },
        request_hash_id: "keep"
    };
    const url = "https://api.zhihu.com/search/preset_words?is_cold_boot=true";
    assert.equal(patterns.filter(pattern => pattern.test(url)).length, 1);
    assert.deepEqual(output(url, body, { request: { method: "POST" } }), {
        ...body,
        preset_words: { ...body.preset_words, words: normalWords }
    });
    assert.deepEqual(run(url, body), {});
    assert.equal(patterns.some(pattern => pattern.test(
        "https://api.zhihu.com/search/preset_words_report",
    )), false);
});

test("detail cleanup preserves normal third-party data and removes only explicit advert fields", () => {
    const body = { content: "正文", third_business: { comment: {}, related_queries: {} },
        ad_info: { data: {} }, adjson: "{}", paid_info: { is_paid: true },
        vip_info: { is_vip: false }, recommendation: ["正常推荐"] };
    for (const url of ["https://api.zhihu.com/answers/v2/123", "https://page-info.zhihu.com/answers/v2/123?x=1",
        "https://api.zhihu.com/articles/v1/456"]) {
        const result = output(url, body);
        const expected = { ...body };
        delete expected.ad_info;
        delete expected.adjson;
        assert.deepEqual(result, expected);
    }
});

test("detail responses containing only normal third_business data pass through byte-for-byte", () => {
    const body = '{ "third_business": {"comment": {}, "related_queries": {"queries": []}} }';
    assert.deepEqual(run("https://page-info.zhihu.com/answers/v2/123", body), {});
});

test("captured detail structures remove only exact ad-link-card entries", () => {
    const paragraph = { type: "paragraph", paragraph: { text: "正文" } };
    const ordinaryLink = { type: "card", card: { card_type: "link-card", content_type: "ARTICLE" } };
    const reward = { type: "card", card: { card_type: "reward_tail_truncate" } };
    const advert = { type: "card", card: { card_type: "ad-link-card", payload: "advert" } };
    const flatAdvert = { card_type: "ad-link-card", payload: "advert" };
    const body = {
        structured_content: { segments: [paragraph, ordinaryLink, advert, reward] },
        structured_content_vip: { segments: [ordinaryLink, advert] },
        content_card_list: [ordinaryLink, flatAdvert, reward],
        third_business: { comment: {}, related_queries: {} },
        ad_info: { data: { id: "advert" } },
        adjson: "{}",
        vip_info: { is_vip: false }
    };
    for (const url of [
        "https://page-info.zhihu.com/answers/v2/123",
        "https://api.zhihu.com/answers/v2/123",
        "https://page-info.zhihu.com/articles/v2/123"
    ]) {
        assert.deepEqual(output(url, body), {
            structured_content: { segments: [paragraph, ordinaryLink, reward] },
            structured_content_vip: { segments: [ordinaryLink] },
            content_card_list: [ordinaryLink, reward],
            third_business: body.third_business,
            vip_info: body.vip_info
        });
    }
});

test("responses without adverts pass through with original bytes and headers", () => {
    const body = '{ "data" : [{"type":"article"}], "paging": {"next":"keep"} }';
    assert.deepEqual(run("https://api.zhihu.com/topstory/recommend", body), {});
});

test("malformed, empty, primitive and unfamiliar JSON responses pass through", () => {
    for (const body of ["", "<html>login</html>", "{broken", "null", "false", "42", "[]",
        '{"data":null}', '{"data":{}}', '{"new_schema":{"data":[{"type":"ad"}]}}']) {
        assert.deepEqual(run("https://api.zhihu.com/topstory/recommend", body), {});
    }
});

test("errors, HTML and non-GET requests pass through", () => {
    const url = "https://api.zhihu.com/topstory/recommend";
    const body = { data: [{ type: "ad" }] };
    for (const status of [204, 301, 401, 403, 500]) {
        const options = status === 204 ? { response: { status, body: "" } } : { response: { status } };
        assert.deepEqual(run(url, body, options), {});
    }
    assert.deepEqual(run(url, body, { response: { headers: { "content-type": "text/html" } } }), {});
    assert.deepEqual(run(url, body, { request: { method: "POST" } }), {});
});

test("JSON response variants supported by the client retain the same filtering", () => {
    const body = { data: [{ type: "feed_advert" }, ...normal] };
    assert.deepEqual(output("https://api.zhihu.com/topstory/recommend", body,
        { response: { status: undefined, statusCode: 200, headers: { "content-type": "application/problem+json" } } }),
    { data: normal });
});

test("module and script ignore unrelated hosts, API endpoints and prefix lookalikes", () => {
    const urls = [
        "https://example.com/topstory/recommend", "https://api.zhihu.com.evil.test/topstory/recommend",
        "https://api.zhihu.com@evil.test/topstory/recommend", "http://api.zhihu.com/topstory/recommend",
        "https://www.zhihu.com/topstory/recommend", "https://page-info.zhihu.com/topstory/recommend",
        "https://api.zhihu.com/topstory/recommendation", "https://api.zhihu.com/next-render-extra",
        "https://api.zhihu.com/questions/123/feeds-backup", "https://api.zhihu.com/people/self",
        "https://api.zhihu.com/answers/v2/123/comments", "https://api.zhihu.com/search/recommend_query_other",
        "https://api.zhihu.com/search/preset_words_report"
    ];
    for (const url of urls) {
        assert.equal(patterns.some(pattern => pattern.test(url)), false, url);
        assert.deepEqual(run(url, { data: [{ type: "ad" }], third_business: {} }), {}, url);
    }
});

test("all intended response endpoints match exactly one module declaration", () => {
    for (const url of [
        "https://api.zhihu.com/topstory/recommend?x=1", "https://web-render.zhihu.com/topstory/recommend",
        "https://api.zhihu.com/topstory/hot-lists/total?x=1", "https://api.zhihu.com/questions/123/feeds?x=1",
        "https://api.zhihu.com/v2/topstory/hot-lists/everyone-seeing?personal_mix_board=1",
        "https://api.zhihu.com/questions/123/feed", "https://api.zhihu.com/next-render?x=1",
        "https://api.zhihu.com/search/recommend_query?x=1", "https://api.zhihu.com/articles/v1/1",
        "https://page-info.zhihu.com/answers/v2/2?x=1",
        "https://api.zhihu.com/search/preset_words?is_cold_boot=true"
    ]) assert.equal(patterns.filter(pattern => pattern.test(url)).length, 1, url);
    assert.match(manifest, /^#!version=1\.0\.18$/m);
    const answerDeclaration = declarations.find(line => line.startsWith("zhihu-answers = "));
    const webQuestionDeclaration = declarations.find(line => line.startsWith("zhihu-web-question = "));
    assert.match(answerDeclaration, /max-size=-1/);
    assert.match(webQuestionDeclaration, /max-size=-1/);
    for (const declaration of declarations) {
        assert.match(declaration, /requires-body=true/);
        assert.match(declaration, /script-path=http:\/\/192\.168\.2\.77:18765\/zhihu\/zhihu-adblock\.js$/);
    }
});

test("advertising interface rejects keep their scope within known Zhihu paths", () => {
    for (const url of ["https://api.zhihu.com/commercial_api", "https://api.zhihu.com/commercial_api/answer/1/bottom-v2",
        "https://api.zhihu.com/bazaar/float_window?x=1", "https://api.zhihu.com/root/window",
        "https://api.zhihu.com/api/v4/ecom_data/config",
        "https://api.zhihu.com/content-promotion/super-coupon/remind?scene_code=detail",
        "https://www.zhihu.com/api/v4/questions/123/banner"]) {
        assert.equal(rejects.some(pattern => pattern.test(url)), true, url);
    }
    for (const url of ["https://api.zhihu.com/root/tab/v2", "https://api.zhihu.com/commercial_api_backup",
        "https://api.zhihu.com/bazaar/float_window_backup", "https://api.zhihu.com/people/self",
        "https://api.zhihu.com/content-promotion/super-coupon/reminder",
        "https://api.zhihu.com/content-promotion/super-coupon/remind_backup",
        "https://www.zhihu.com/api/v4/questions/not-a-number/banner",
        "https://www.zhihu.com/api/v4/questions/123/banners",
        "https://www.zhihu.com/api/v4/topics/rank_list/question/123/related",
        "https://www.zhihu.com/api/v4/topics/rank_list/question/not-a-number/related",
        "https://www.zhihu.com/api/v4/topics/rank_list/question/123/related-items",
        "https://api.zhihu.com.evil.test/commercial_api", "https://api.zhihu.com/notifications/v3/message"]) {
        assert.equal(rejects.some(pattern => pattern.test(url)), false, url);
    }
});

test("public Zhihu HTTPDNS endpoints are rejected without pinning a shared CDN IP", () => {
    assert.deepEqual(networkRules, [
        "DOMAIN,appcloud.zhihu.com,REJECT",
        "DOMAIN,appcloud2.in.zhihu.com,REJECT",
        "IP-CIDR,103.41.167.237/32,REJECT,no-resolve",
        "IP-CIDR,118.89.204.198/32,REJECT,no-resolve",
        "IP-CIDR,182.61.194.7/32,REJECT,no-resolve",
        "IP-CIDR6,2402:4e00:1200:ed00:0:9089:6dac:96b6/128,REJECT,no-resolve"
    ]);
    assert.doesNotMatch(manifest, /43\.242\.197\.211/);
    assert.doesNotMatch(manifest, /240e:951:2c10:6010:47::7/i);
});

test("the script safely finishes when called without a request or response", () => {
    let calls = 0;
    vm.runInNewContext(source, { $done(result) {
        assert.equal(JSON.stringify(result), "{}");
        calls++;
    } }, { timeout: 1000 });
    assert.equal(calls, 1);
});

test("logs report actual removals without query parameters, credentials or response contents", () => {
    const logs = [];
    const body = { data: [{ type: "feed_advert", title: "PRIVATE_AD_BODY" },
        { type: "article", content: "PRIVATE_ARTICLE_BODY" }, { type: "ad" }], ad_info: {} };
    output("https://api.zhihu.com/questions/987654/feeds?token=PRIVATE_QUERY", body, {
        logs, request: { headers: { Authorization: "PRIVATE_AUTH", Cookie: "PRIVATE_COOKIE" } }
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[知乎去广告\] api\.zhihu\.com\/questions\/:id\/feeds \| 处理完成/);
    assert.match(logs[0], /列表 3→1，移除广告 2 条/);
    assert.match(logs[0], /移除广告字段 ad_info/);
    assert.doesNotMatch(logs[0], /PRIVATE_|987654|\?/);
});

test("structured diagnostics expose only schema names and safe type values", () => {
    const logs = [];
    const body = { data: [
        { type: "feed_advert", title: "PRIVATE_AD_BODY" },
        { type: "article", content: "PRIVATE_ARTICLE_BODY", private_key: "PRIVATE_VALUE" },
        { secret_field: "PRIVATE_SECRET" }
    ] };
    output("https://api.zhihu.com/topstory/recommend?token=PRIVATE_QUERY", body, { logs });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /结构 data=2\[/);
    assert.match(logs[0], /type:article×1/);
    assert.match(logs[0], /keys:secret_field×1/);
    assert.doesNotMatch(logs[0], /PRIVATE_|\?/);
});

test("detail cards remove explicit advert type families and retain ordinary cards", () => {
    const normalCards = [
        { type: "card", card: { card_type: "link-card" } },
        { type: "card", card: { card_type: "fee-link-card" } },
        { type: "card", card: { card_type: "reward_tail_truncate" } }
    ];
    const body = { structured_content: { segments: [
        ...normalCards,
        { type: "card", card: { card_type: "sponsored-card" } },
        { type: "card", card: { card_type: "commercial_card" } },
        { card_type: "promotion-card" }
    ] } };
    assert.deepEqual(output("https://page-info.zhihu.com/answers/v2/123", body), {
        structured_content: { segments: normalCards }
    });
});

test("logs distinguish zero removals, unexpected structures and response failures", () => {
    const url = "https://api.zhihu.com/topstory/recommend";
    const cases = [
        [{ data: [{ type: "article" }] }, {}, /未发现可移除广告.*列表 1→1，移除广告 0 条/],
        [{ unknown: [] }, {}, /响应结构未识别，保留原响应/],
        ["{broken", {}, /解析异常，保留原响应/],
        ["null", {}, /跳过：JSON 根节点格式不符/],
        [{ data: [] }, { response: { status: 403 } }, /跳过：HTTP 403/],
        ["<html>login</html>", { response: { headers: { "content-type": "text/html" } } }, /跳过：非 JSON 响应/],
        [{ data: [] }, { request: { method: "POST" } }, /跳过：请求方法应为 GET/],
        [{ data: [] }, { response: { body: undefined } }, /跳过：缺少响应正文/]
    ];
    for (const [body, options, expected] of cases) {
        const logs = [];
        assert.deepEqual(run(url, body, { ...options, logs }), {});
        assert.equal(logs.length, 1);
        assert.match(logs[0], expected);
    }
});

test("field-only removals are logged separately from list item counts", () => {
    const logs = [];
    output("https://page-info.zhihu.com/answers/v2/987654?session=PRIVATE_QUERY",
        { content: "PRIVATE_CONTENT", ad_info: {} }, { logs });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /answers\/v2\/:id.*移除广告字段 ad_info/);
    assert.doesNotMatch(logs[0], /列表|987654|PRIVATE_/);
});

test("unrelated requests do not produce module logs", () => {
    const logs = [];
    assert.deepEqual(run("https://example.com/topstory/recommend", { data: [{ type: "ad" }] }, { logs }), {});
    assert.deepEqual(logs, []);
});

test("a broken logging sink cannot prevent filtering or completion", () => {
    const result = output("https://api.zhihu.com/topstory/recommend",
        { data: [{ type: "ad" }, { type: "article" }] },
        { console: { log() { throw new Error("log unavailable"); } } });
    assert.deepEqual(result, { data: [{ type: "article" }] });
});


test("debug=false disables logging while preserving ad removal", () => {
    const logs = [];
    const result = output("https://api.zhihu.com/topstory/recommend", {
        data: [{ type: "feed_advert" }, { type: "feed", id: "normal" }]
    }, { argument: "debug=false", logs });
    assert.deepEqual(result.data, [{ type: "feed", id: "normal" }]);
    assert.deepEqual(logs, []);
});


test("new answer list and next endpoints remove only explicit adverts", () => {
    for (const suffix of ["questions/123/answers?limit=10", "next-bff?x=1", "next-data"]) {
        const url = "https://api.zhihu.com/" + suffix;
        assert.equal(patterns.filter(pattern => pattern.test(url)).length, 1);
        const body = { data: [{ type: "ad" }, ...normal], vip_info: { is_vip: false } };
        assert.deepEqual(output(url, body), { ...body, data: normal });
    }
    const url = "https://api.zhihu.com/questions/123/answers";
    const body = { data: { ad_info: { id: "ad" }, answer: { content: "normal" } }, query_info: { keep: true } };
    assert.deepEqual(output(url, body), { data: { answer: { content: "normal" } }, query_info: { keep: true } });
});

test("v2 search suggestions retain ordinary suggestions and metadata", () => {
    const url = "https://api.zhihu.com/search/recommend_query/v2?x=1";
    assert.equal(patterns.filter(pattern => pattern.test(url)).length, 1);
    const body = { recommend_queries: { queries: [{ query: "normal" }, { query: "ad", ad_commercial_json: "{}" }] } };
    assert.deepEqual(output(url, body), { recommend_queries: { queries: [{ query: "normal" }] } });
});

test("new direct ad rejects exclude adjacent non-ad endpoints", () => {
    for (const url of ["https://api.zhihu.com/ad-style-service/request?x=1", "https://api.zhihu.com/distribute/rhea/qa_ad_card/h5/recommendation?x=1", "https://www.zhihu.com/commercial_api/banners_v3/mobile_banner"]) {
        assert.equal(rejects.some(pattern => pattern.test(url)), true, url);
        assert.equal(rejects.some(pattern => pattern.test(url.split("?")[0] + "_other")), false, url);
    }
});


test("API transparent rewrite preserves the URL and never rewrites a shared-IP neighbour", () => {
    const line = manifest.split(/\r?\n/).find(line => line.endsWith(" header"));
    assert.ok(line);
    const [pattern, replacement] = line.split(" ");
    const match = new RegExp(pattern);
    for (const url of [
        "https://api.zhihu.com/questions/123/answers?include=foo%2Cbar&offset=10",
        "https://api.zhihu.com/next-bff?cursor=a%2Fb%3D",
        "https://api.zhihu.com/root/tab/v2"
    ]) {
        assert.ok(match.test(url));
        assert.equal(url.replace(match, replacement), url);
    }
    for (const url of ["https://43.242.197.211/questions/123/answers", "https://pic2.zhimg.com/image.jpg", "https://api.zhihu.com.evil.test/next-bff", "https://api.zhihu.com@evil.test/"]) {
        assert.equal(match.test(url), false, url);
    }
    const fallback = manifest.indexOf(line);
    assert.ok(manifest.split(/\r?\n/).filter(line => line.endsWith(" - reject-dict"))
        .every(line => manifest.indexOf(line) < fallback), "ad rejects run before the fallback route rewrite");
});


test("route diagnostics never change requests or disclose IDs, query values, headers or bodies", () => {
    const probe = manifest.split(/\r?\n/).find(line => line.startsWith("zhihu-route-probe ="));
    assert.ok(probe);
    const pattern = new RegExp(probe.match(/, pattern=(.*?), timeout=/)[1]);
    const url = "https://www.zhihu.com/api/v4/questions/987654321/answers?token=PRIVATE";
    assert.ok(pattern.test(url));
    for (const argument of ["debug=true&phase=probe", "debug=false&phase=probe"]) {
        const logs = [];
        let calls = 0;
        const request = { url, headers: { Authorization: "SECRET" }, body: "PRIVATE_BODY" };
        const before = JSON.stringify(request);
        vm.runInNewContext(source, {
            $request: request, $argument: argument,
            console: { log: line => logs.push(line) },
            $done: value => { assert.equal(JSON.stringify(value), "{}"); calls++; }
        });
        assert.equal(calls, 1);
        assert.equal(JSON.stringify(request), before);
        assert.equal(logs.length, argument.startsWith("debug=false") ? 0 : 1);
        if (logs.length) {
            assert.match(logs[0], /www\.zhihu\.com\/api\/v4\/questions\/:segment\/answers/);
            assert.doesNotMatch(logs[0], /PRIVATE|SECRET|987654321/);
        }
    }

    const logs = [];
    vm.runInNewContext(source, {
        $request: { url: "https://www.zhihu.com/sc-profiler-zhapp", method: "POST" },
        $argument: "debug=true&phase=probe",
        console: { log: line => logs.push(line) },
        $done: value => assert.equal(JSON.stringify(value), "{}")
    });
    assert.deepEqual(logs, []);
});


test("explicit extra advertisement types are removed without filtering ordinary articles and videos", () => {
    const retained = [{ extra: { content_type: "article" } }, { extra: { content_type: "zvideo" } },
        { extra: { content_type: "answer" } }, { extra: { content_type: "unknown" } }];
    const result = output("https://api.zhihu.com/topstory/recommend", {
        data: [...retained, { extra: { content_type: "ad" } }, { extra: { content_type: "promotion" } }]
    });
    assert.deepEqual(result.data, retained);
});


test("QUIC sniffing uses the discovered domain without changing TLS or DNS settings", () => {
    const sniffer = subscription.match(/^sniffer:\n([\s\S]*?)(?=^[^ \n])/m);
    assert.ok(sniffer);
    assert.match(sniffer[0], /^  override-destination: false$/m);
    assert.match(sniffer[0], /^    QUIC:\n      ports: \[443\]\n      override-destination: true$/m);
    assert.doesNotMatch(subscription, /^tun:/m);
    assert.doesNotMatch(subscription, /dns-hijack/);
    assert.doesNotMatch(manifest, /43\.242\.197\.211|skip-server-cert-verify\s*=\s*true/i);
});

test("observed shared-IP host routes preserve their own authority and encoded URL", () => {
    const routes = manifest.split(/\r?\n/).filter(line => line.endsWith(" header"))
        .map(line => { const [pattern, target] = line.split(" "); return { regex: new RegExp(pattern), target }; });
    for (const host of ["duga.zhihu.com", "m-cloud.zhihu.com", "appcloud.zhihu.com", "pic2.zhimg.com", "pic3.zhimg.com", "pic4.zhimg.com", "pica.zhimg.com"]) {
        const url = `https://${host}/a%2Fb?cursor=a%2Fb%3D&x=1`;
        const route = routes.find(route => route.regex.test(url));
        assert.ok(route, host);
        assert.equal(url.replace(route.regex, route.target), url);
    }
    for (const host of ["duga.zhihu.com.evil.test", "m-cloud.zhihu.com@evil.test", "pic2.zhimg.com.evil.test", "unrelated.example", "unknown.zhihu.com"]) {
        assert.equal(routes.some(route => route.regex.test(`https://${host}/a`)), false, host);
    }
});

test("comment adverts clear only the advertisement payload and preserve conversations", () => {
    for (const kind of ["answers", "articles", "pins", "comment", "comments"]) {
        for (const level of ["root", "child"]) {
            const url = `https://api.zhihu.com/comment_v5/${kind}/123/${level}_comment?order_by=score`;
            assert.ok(patterns.some(pattern => pattern.test(url)));
            const body = { ad_info: { data: { creative: "ad" } }, data: [{ id: "456", content: "normal comment", can_reply: true }], paging: { next: "next" }, account: { vip: false } };
            assert.deepEqual(output(url, body), { ...body, ad_info: {} });
        }
    }
});

test("comment endpoints pass through empty adverts, absent adverts and unrelated paths", () => {
    const url = "https://api.zhihu.com/comment_v5/answers/123/root_comment";
    for (const body of [{ ad_info: {}, data: [] }, { data: [{ content: "ordinary" }] }]) {
        assert.deepEqual(run(url, body), {});
    }
    for (const other of [url + "_settings", "https://other.example/comment_v5/answers/123/root_comment", "https://api.zhihu.com/comment_v5/people/123/root_comment"]) {
        assert.deepEqual(run(other, { ad_info: { data: "keep" } }), {});
        assert.equal(patterns.some(pattern => pattern.test(other)), false);
    }
});

test("native and web question details remove ad_info without changing question data", () => {
    for (const url of ["https://api.zhihu.com/questions/123?include=details", "https://www.zhihu.com/api/v4/questions/123?include=details", "https://www.zhihu.com/api/v4/questions/123/answers?offset=10"]) {
        assert.ok(patterns.some(pattern => pattern.test(url)), url);
        const body = { title: "ordinary question", ad_info: { data: "advert" }, data: { ad_info: { slot: "advert" }, answer_count: 40 }, query_info: { token: "preserve" } };
        assert.deepEqual(output(url, body), { title: body.title, data: { answer_count: 40 }, query_info: body.query_info });
    }
    for (const suffix of ["/banner", "/inviters", "/settings"]) {
        const url = "https://www.zhihu.com/api/v4/questions/123" + suffix;
        assert.deepEqual(run(url, { ad_info: { data: "keep" } }), {});
    }
});

test("web recommendations filter explicit adverts and retain ordinary recommendations", () => {
    for (const kind of ["answers", "articles"]) {
        for (const ending of ["recommendation", "recommendations"]) {
            const url = `https://www.zhihu.com/api/v4/${kind}/123/${ending}?offset=0`;
            assert.ok(patterns.some(pattern => pattern.test(url)));
            const normal = [{ type: "answer", id: 1 }, { type: "article", id: 2 }, { type: "video", id: 3 }, { type: "unknown", id: 4 }];
            const body = { data: [...normal, { type: "ad" }, { ad_info: { data: { slot: 1 } } }], paging: { next: "keep" } };
            assert.deepEqual(output(url, body), { ...body, data: normal });
            assert.deepEqual(run(url, { data: normal }), {});
        }
    }
});
