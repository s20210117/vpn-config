// Clash-Client / Surge 风格的 HTTP 响应脚本。
// 广告字段依据：blackmatrix7 的哲也同学（script/zheye）；本文件为独立精简实现。
// 只处理指定知乎接口，不访问网络或读写账号、会员、黑名单等数据。
(function () {
    "use strict";

    if (typeof $argument === "string" && /(?:^|&)phase=probe(?:&|$)/.test($argument)) {
        try {
            var probeAddress = typeof $request === "object" &&
                /^https:\/\/(www\.zhihu\.com)(\/[^?#]*)/.exec($request.url || "");
            if (probeAddress && probeAddress[2] !== "/sc-profiler-zhapp" &&
                !/(?:^|&)debug=false(?:&|$)/i.test($argument)) {
                var known = /^(?:api|v[0-9]+|questions|answers|articles|feeds?|next-(?:bff|data|render)|topstory|recommend|hot-lists|commercial_api|ad-style-service|request|recommendations?|search|recommend_query|distribute|rhea|qa_ad_card|h5)$/;
                var parts = probeAddress[2].split("/").slice(1, 9).map(function (part) {
                    return known.test(part) ? part : (part ? ":segment" : "");
                });
                console.log("[知乎去广告][入口诊断 1.0.18] " + probeAddress[1] + "/" + parts.join("/"));
            }
        } catch (error) {}
        $done({});
        return;
    }

    var trace = {
        endpoint: "", reason: "处理完成", before: null, after: null,
        removed: 0, fields: [], structures: []
    };

    function writeLog() {
        if (!trace.endpoint || (typeof $argument === "string" && /(?:^|&)debug=false(?:&|$)/i.test($argument))) return;
        try {
            if (typeof console === "undefined" || typeof console.log !== "function") return;
            var counts = trace.before === null ? "" :
                "，列表 " + trace.before + "→" + trace.after + "，移除广告 " + trace.removed + " 条";
            var fields = trace.fields.length ? "，移除广告字段 " + trace.fields.join("、") : "";
            var structures = trace.structures.length ? "，结构 " + trace.structures.join("；") : "";
            console.log("[知乎去广告] " + trace.endpoint + " | " + trace.reason + counts + fields + structures);
        } catch (error) {
            // 日志写入失败时仍正常交付过滤结果。
        }
    }

    function object(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function marked(value, key) {
        return Object.prototype.hasOwnProperty.call(value, key) &&
            value[key] !== null && value[key] !== false &&
            value[key] !== undefined && value[key] !== "" && value[key] !== 0;
    }

    function advertType(value) {
        return /(?:^|[_-])(?:ad|advert|advertisement|commercial|sponsor|sponsored|promotion|promote)(?:[_-]|$)/i
            .test(String(value || ""));
    }

    function advert(item) {
        if (!object(item)) return false;
        return item.type === "market_card" || advertType(item.type) || item.is_advertiser === true ||
            (object(item.extra) && (item.extra.type === "SvipActivity" ||
                item.extra.content_type === "ad" || item.extra.content_type === "promotion" ||
                marked(item.extra, "ad") || marked(item.extra, "promotion"))) ||
            marked(item, "ad") || marked(item, "adjson") ||
            (Array.isArray(item.ad_list) ? item.ad_list.length > 0 : marked(item, "ad_list")) ||
            marked(item, "promotion_extra") ||
            (object(item.ad_info) && marked(item.ad_info, "data"));
    }

    function typedAdvert(item) {
        if (advert(item)) return true;
        if (!object(item)) return false;
        return advertType(item.type);
    }

    function bffAdvert(item) {
        if (advert(item)) return true;
        if (!object(item) || !object(item.origin_data)) return false;
        var origin = item.origin_data;
        return typedAdvert(origin) || advertType(origin.resource_type);
    }

    function advertCard(item) {
        if (!object(item)) return false;
        var cardType = item.card_type;
        if (!cardType && item.type === "card" && object(item.card)) cardType = item.card.card_type;
        return advertType(cardType);
    }

    function schemaToken(value) {
        var token = String(value === undefined || value === null ? "" : value);
        return /^[A-Za-z0-9_.:-]{1,64}$/.test(token) ? token : "other";
    }

    function describeItems(label, items) {
        if (!Array.isArray(items)) return;
        var order = [], counts = {};
        for (var index = 0; index < items.length; index++) {
            var item = items[index], parts = [];
            if (!object(item)) {
                parts.push(item === null ? "null" : typeof item);
            } else {
                var classifierKeys = [
                    "type", "card_type", "target_type", "content_type",
                    "business_type", "object_type", "match_template_key"
                ];
                for (var keyIndex = 0; keyIndex < classifierKeys.length; keyIndex++) {
                    var key = classifierKeys[keyIndex];
                    if (item[key] !== undefined && item[key] !== null) {
                        parts.push(key + ":" + schemaToken(item[key]));
                    }
                }
                if (object(item.card) && item.card.card_type !== undefined) {
                    parts.push("card.card_type:" + schemaToken(item.card.card_type));
                }
                if (!parts.length) {
                    var keys = Object.keys(item).filter(function (candidate) {
                        return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(candidate);
                    }).sort().slice(0, 8);
                    parts.push("keys:" + (keys.length ? keys.join("+") : "none"));
                }
            }
            var signature = parts.join("+");
            if (!Object.prototype.hasOwnProperty.call(counts, signature)) {
                if (order.length >= 8) continue;
                order.push(signature);
                counts[signature] = 0;
            }
            counts[signature]++;
        }
        trace.structures.push(label + "=" + items.length + "[" + order.map(function (signature) {
            return signature + "×" + counts[signature];
        }).join(",") + "]");
    }

    function describeObject(label, value) {
        if (!object(value)) return;
        var keys = Object.keys(value).filter(function (candidate) {
            return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(candidate);
        }).sort().slice(0, 12);
        trace.structures.push(label + "={" + keys.join(",") + "}");
    }

    function rewrite(request, response) {
        if (!request) return {};
        var address = /^https:\/\/(api|web-render|page-info|www)\.zhihu\.com(\/[^#]*)$/.exec(request.url || "");
        if (!address) return {};
        var host = address[1];
        var path = address[2].split("?")[0];
        var nestedHot = host === "api" &&
            /^\/v2\/topstory\/hot-lists\/everyone-seeing\/?$/.test(path);
        var feed = ((host === "api" || host === "web-render") &&
            /^\/topstory\/(?:recommend|hot-lists)(?:\/|$)/.test(path)) || nestedHot;
        var question = (host === "api" && /^\/questions\/\d+(?:\/(?:feeds?|answers))?\/?$/.test(path)) ||
            (host === "www" && /^\/api\/v4\/questions\/\d+(?:\/(?:feeds?|answers))?\/?$/.test(path));
        var recommendations = host === "www" &&
            /^\/api\/v4\/(?:articles|answers)\/\d+\/recommendations?\/?$/.test(path);
        var nextAddress = host === "api" && /^\/next-(render|bff|data)\/?$/.exec(path);
        var next = Boolean(nextAddress);
        var search = host === "api" && /^\/search\/recommend_query(?:\/v2)?\/?$/.test(path);
        var searchPreset = host === "api" && /^\/search\/preset_words\/?$/.test(path);
        var detail = (host === "api" || host === "page-info") &&
            /^\/(?:answers|articles)\/v\d+\/\d+\/?$/.test(path);
        var comments = host === "api" &&
            /^\/comment_v5\/(?:answers|pins|comments?|articles)\/\d+\/(?:root|child)_comment\/?$/.test(path);
        if (!feed && !question && !next && !search && !searchPreset &&
            !detail && !comments && !recommendations) return {};

        // 只记录接口，不记录查询参数、内容 ID、请求头或响应正文。
        var endpoint = nestedHot ? "/v2/topstory/hot-lists/everyone-seeing" :
            (feed ? /^\/topstory\/(?:recommend|hot-lists)/.exec(path)[0] :
                path.replace(/\/\d+(?=\/|$)/g, "/:id"));
        trace.endpoint = host + ".zhihu.com" + endpoint;
        if (!response || typeof response.body !== "string") {
            trace.reason = "跳过：缺少响应正文";
            return {};
        }
        var method = String(request.method || "GET").toUpperCase();
        var expectedMethod = searchPreset ? "POST" : "GET";
        if (method !== expectedMethod) {
            trace.reason = "跳过：请求方法应为 " + expectedMethod;
            return {};
        }
        var status = Number(response.statusCode || response.status);
        if (status && (status < 200 || status >= 300)) {
            trace.reason = "跳过：HTTP " + status;
            return {};
        }
        var headers = response.headers || {};
        var contentType = Object.keys(headers).filter(function (key) {
            return key.toLowerCase() === "content-type";
        }).map(function (key) { return String(headers[key]); }).join(";");
        if (contentType && !/\b(?:application|text)\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
            trace.reason = "跳过：非 JSON 响应";
            return {};
        }

        var body = JSON.parse(response.body);
        if (!object(body)) {
            trace.reason = "跳过：JSON 根节点格式不符";
            return {};
        }
        var changed = false;

        function filter(owner, key, predicate) {
            if (!object(owner) || !Array.isArray(owner[key])) return;
            var original = owner[key];
            var kept = original.filter(function (item) { return !predicate(item); });
            if (trace.before === null) {
                trace.before = 0;
                trace.after = 0;
            }
            trace.before += original.length;
            trace.after += kept.length;
            trace.removed += original.length - kept.length;
            if (kept.length !== original.length) {
                owner[key] = kept;
                changed = true;
            }
        }

        function remove(key, owner, label) {
            owner = owner || body;
            if (object(owner) && Object.prototype.hasOwnProperty.call(owner, key)) {
                delete owner[key];
                trace.fields.push(label || key);
                changed = true;
            }
        }

        if (feed || question || recommendations || (nextAddress && nextAddress[1] === "render")) {
            filter(body, "data", advert);
        }
        if (nestedHot && object(body.data)) filter(body.data, "data", advert);
        if (nextAddress && nextAddress[1] === "bff") filter(body, "data", bffAdvert);
        if (nextAddress && nextAddress[1] === "data") {
            filter(body, "data", typedAdvert);
            if (object(body.data)) filter(body.data, "data", typedAdvert);
        }
        if (feed || question) filter(body, "dataV1", advert);
        if (question) {
            remove("ad_info");
            if (object(body.data)) remove("ad_info", body.data, "data.ad_info");
        }
        if (search) filter(body.recommend_queries, "queries", function (item) {
            return object(item) && marked(item, "ad_commercial_json");
        });
        if (searchPreset) filter(body.preset_words, "words", function (item) {
            return object(item) && (marked(item, "ad_commercial_json") ||
                marked(item, "preset_word_ad_commercial_json"));
        });
        if (detail) {
            remove("ad_info");
            remove("adjson");
            filter(body.structured_content, "segments", advertCard);
            filter(body.structured_content_vip, "segments", advertCard);
            filter(body, "content_card_list", advertCard);
        }
        if (comments && Object.prototype.hasOwnProperty.call(body, "ad_info") &&
            (!object(body.ad_info) || Object.keys(body.ad_info).length > 0)) {
            body.ad_info = {};
            trace.fields.push("ad_info");
            changed = true;
        }
        if (feed || question || recommendations || next) {
            describeItems("data", body.data);
            describeItems("dataV1", body.dataV1);
            if (object(body.data)) describeItems("data.data", body.data.data);
        }
        if (detail) {
            describeItems("structured_content.segments",
                object(body.structured_content) ? body.structured_content.segments : null);
            describeItems("structured_content_vip.segments",
                object(body.structured_content_vip) ? body.structured_content_vip.segments : null);
            describeItems("content_card_list", body.content_card_list);
            describeObject("third_business", body.third_business);
        }
        if (!changed) trace.reason = trace.before === null && !detail ?
            "响应结构未识别，保留原响应" : "未发现可移除广告，保留原响应";
        return changed ? { body: JSON.stringify(body) } : {};
    }

    var result = {};
    try {
        result = rewrite(
            typeof $request === "object" ? $request : null,
            typeof $response === "object" ? $response : null);
    } catch (error) {
        // 新接口、非 JSON 或格式变化时保留原响应，不让脚本阻断正常浏览。
        trace.reason = "解析异常，保留原响应";
    }
    writeLog();
    $done(result);
})();
