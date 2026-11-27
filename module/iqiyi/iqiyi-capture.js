// 临时诊断脚本：只记录 JSON 结构，不修改爱奇艺响应。
(function () {
    "use strict";

    var collector = "";
    if (typeof $argument === "string") {
        var configured = /(?:^|&)collector=([^&]*)/.exec($argument);
        if (configured) {
            try { collector = decodeURIComponent(configured[1]); } catch (error) {}
        }
    }
    var debug = !(typeof $argument === "string" && /(?:^|&)debug=false(?:&|$)/i.test($argument));
    var allowed = {
        "api.iqiyi.com": 1,
        "iface2.iqiyi.com": 1,
        "cards.iqiyi.com": 1,
        "comment-card.iqiyi.com": 1,
        "cards-css.iqiyi.com": 1,
        "puma-api.iqiyi.com": 1,
        "m.iqiyi.com": 1,
        "policy.video.iqiyi.com": 1,
        "act.vip.iqiyi.com": 1,
        "access.if.iqiyi.com": 1,
        "kjp.cupid.iqiyi.com": 1,
        "t7z.cupid.iqiyi.com": 1,
        "59.39.2.11": 1,
        "116.211.198.237": 1,
        "111.63.147.158": 1,
        "103.44.59.54": 1
    };
    var classifierKeys = {
        alias_name: 1,
        block_class: 1,
        card_type: 1,
        cardType: 1,
        item_type: 1,
        itemType: 1,
        layout_type: 1,
        layoutType: 1,
        ad_type: 1,
        adType: 1,
        ad_id: 1,
        adId: 1,
        slot_id: 1,
        slotId: 1,
        position: 1,
        position_id: 1,
        positionId: 1,
        business_type: 1,
        businessType: 1
    };
    var sensitive = /(?:token|auth|cookie|session|passport|account|phone|email|device|user|\buid\b)/i;
    var adKey = /(?:^|_)(?:ad|ads|advert|advertise|advertisement|cupid|commercial|marketing|promotion|sponsor|slot)(?:_|$)|^(?:ad[A-Z]|adSlots?$)|^(?:alias_name|block_class)$/;
    var adValue = /(?:^|[_-])ad(?:[_-]|$)|advert|cupid|commercial|sponsor|promotion|广告/i;
    var finished = false;

    function done() {
        if (!finished) {
            finished = true;
            $done({});
        }
    }

    function log(message) {
        if (!debug) return;
        try { console.log(message); } catch (error) {}
    }

    function header(headers, name) {
        headers = headers || {};
        var wanted = name.toLowerCase();
        var keys = Object.keys(headers);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].toLowerCase() === wanted) return String(headers[keys[i]]);
        }
        return "";
    }

    function endpoint(value) {
        var match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/.exec(value || "");
        if (!match || !allowed[match[2].toLowerCase()]) return null;
        return {
            host: match[2].toLowerCase(),
            url: match[1].toLowerCase() + "://" + match[2].toLowerCase() + (match[3] || "/")
        };
    }

    function kind(value) {
        if (value === null) return "null";
        if (Array.isArray(value)) return "array";
        return typeof value;
    }

    function safeValue(key, value) {
        if (value === null || typeof value === "boolean" || typeof value === "number") return value;
        if (typeof value !== "string") return kind(value);
        if (sensitive.test(key)) return "[redacted]";
        var text = value.replace(/[\r\n\t]+/g, " ").trim();
        if (/^https?:\/\//i.test(text)) text = text.replace(/([?#]).*$/, "");
        if (text.length > 160) text = text.slice(0, 160) + "...";
        return text;
    }

    function summarize(body) {
        var paths = [], pathSeen = {}, classifiers = [], classifierSeen = {};
        var findings = [], findingSeen = {}, nodes = 0, truncated = false;

        function remember(list, seen, value, limit) {
            var encoded = typeof value === "string" ? value : JSON.stringify(value);
            if (seen[encoded]) return;
            if (list.length >= limit) {
                truncated = true;
                return;
            }
            seen[encoded] = 1;
            list.push(value);
        }

        function walk(value, path, depth) {
            if (nodes++ >= 12000 || depth > 24) {
                truncated = true;
                return;
            }
            if (Array.isArray(value)) {
                remember(paths, pathSeen, path + "[]=array", 800);
                for (var ai = 0; ai < value.length; ai++) walk(value[ai], path + "[]", depth + 1);
                return;
            }
            if (!value || typeof value !== "object") return;

            var keys = Object.keys(value);
            var signature = {};
            var hasSignature = false;
            for (var si = 0; si < keys.length; si++) {
                var signatureKey = keys[si];
                if (classifierKeys[signatureKey] && value[signatureKey] !== undefined) {
                    signature[signatureKey] = safeValue(signatureKey, value[signatureKey]);
                    hasSignature = true;
                }
            }
            if (hasSignature) remember(classifiers, classifierSeen, { path: path || "$", fields: signature }, 500);

            for (var i = 0; i < keys.length; i++) {
                var key = keys[i], child = value[key];
                var childPath = (path ? path + "." : "") + key;
                remember(paths, pathSeen, childPath + "=" + kind(child), 800);
                if ((adKey.test(key) || (typeof child === "string" && adValue.test(child))) && !sensitive.test(key)) {
                    remember(findings, findingSeen, {
                        path: childPath,
                        value: safeValue(key, child)
                    }, 500);
                }
                walk(child, childPath, depth + 1);
            }
        }

        walk(body, "", 0);
        return { paths: paths, classifiers: classifiers, findings: findings, truncated: truncated };
    }

    try {
        var request = typeof $request === "object" ? $request : {};
        var response = typeof $response === "object" ? $response : {};
        var target = endpoint(request.url);
        var status = Number(response.statusCode || response.status || 0);
        var contentType = header(response.headers, "content-type");
        var text = typeof response.body === "string" ? response.body : "";
        var trimmed = text.replace(/^\s+/, "");
        if (!target || (status && (status < 200 || status >= 300)) || !text ||
                (!/\bjson\b/i.test(contentType) && trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")) {
            return done();
        }

        if (!/^https?:\/\/[^/?#\s]+\/[^#\s]*$/i.test(collector)) {
            log("[爱奇艺抓广告] 请设置 collector 接收地址，响应保持原样");
            return done();
        }
        var parsed = JSON.parse(text);
        var record = {
            version: 1,
            capturedAt: Date.now(),
            request: { method: request.method || "", url: target.url },
            response: { status: status, contentType: contentType.slice(0, 120), bodyCharacters: text.length },
            structure: summarize(parsed)
        };
        var timer = setTimeout(function () {
            log("[爱奇艺抓广告] 接收器超时 " + target.url);
            done();
        }, 1400);
        $httpClient.post({
            url: collector,
            headers: { "Content-Type": "application/json", "X-IQIYI-Capture": "v1" },
            body: JSON.stringify(record),
            timeout: 1
        }, function (error, answer) {
            clearTimeout(timer);
            var code = answer && (answer.status || answer.statusCode);
            log("[爱奇艺抓广告] " + target.url + " | " + (error ? "发送失败" : "已保存 " + code));
            done();
        });
    } catch (error) {
        log("[爱奇艺抓广告] 解析失败，响应保持原样");
        done();
    }
})();
