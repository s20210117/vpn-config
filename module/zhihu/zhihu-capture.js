// 临时诊断脚本：只记录脱敏后的 JSON 结构，不修改知乎响应。
(function () {
    "use strict";

    var collector = "http://192.168.2.77:18767/capture";
    var debug = !(typeof $argument === "string" && /(?:^|&)debug=false(?:&|$)/i.test($argument));
    var allowed = {
        "zhihu.com": 1,
        "api.zhihu.com": 1,
        "web-render.zhihu.com": 1,
        "page-info.zhihu.com": 1,
        "page-modular.zhihu.com": 1,
        "www.zhihu.com": 1
    };
    var classifierKeys = {
        type: 1,
        object_type: 1,
        objectType: 1,
        card_type: 1,
        cardType: 1,
        item_type: 1,
        itemType: 1,
        target_type: 1,
        targetType: 1,
        content_type: 1,
        contentType: 1,
        action_type: 1,
        actionType: 1,
        business_type: 1,
        businessType: 1,
        biz_type: 1,
        bizType: 1,
        layout_type: 1,
        layoutType: 1,
        ad_type: 1,
        adType: 1,
        promotion_type: 1,
        promotionType: 1,
        source_type: 1,
        sourceType: 1,
        style: 1
    };
    var sensitiveKey = /(?:token|auth|cookie|session|passport|account|phone|email|device|user|uid|uuid|member|name|title|content|excerpt|description|headline|avatar|image|video|url|uri|link|tracking|trace|request_id|response_id|(?:^|_)id$)/i;
    var adKey = /(?:^|_)(?:ad|ads|advert|advertise|advertisement|commercial|marketing|promotion|promote|sponsor|sponsored|brand|banner|slot)(?:_|$)|^(?:ad[A-Z]|adjson$)/;
    var adValue = /(?:^|[_-])ad(?:[_-]|$)|advert|commercial|marketing|promotion|promote|sponsor|brand|广告|推广|赞助/i;
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

    function privateSegment(segment) {
        var decoded = segment;
        try { decoded = decodeURIComponent(segment); } catch (error) {}
        return /^\d+$/.test(decoded) ||
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded) ||
            /^(?:[0-9a-f]{16,}|[A-Za-z0-9_-]{32,})$/.test(decoded);
    }

    function safePath(path) {
        var parts = (path || "/").split("/");
        for (var i = 0; i < parts.length; i++) {
            if (privateSegment(parts[i])) parts[i] = ":id";
            else if (parts[i].length > 80) parts[i] = ":segment";
        }
        return parts.join("/") || "/";
    }

    function endpoint(value) {
        var match = /^(https?):\/\/([^/:?#]+)(?::\d+)?(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/.exec(value || "");
        if (!match || !allowed[match[2].toLowerCase()]) return null;
        return {
            host: match[2].toLowerCase(),
            url: match[1].toLowerCase() + "://" + match[2].toLowerCase() + safePath(match[3] || "/")
        };
    }

    function kind(value) {
        if (value === null) return "null";
        if (Array.isArray(value)) return "array";
        return typeof value;
    }

    function safeKey(key) {
        if (privateSegment(key) || key.length > 80) return ":key";
        return key;
    }

    function safeValue(key, value) {
        if (value === null || typeof value === "boolean") return value;
        if (typeof value === "number") {
            return classifierKeys[key] || !sensitiveKey.test(key) ? value : "[redacted]";
        }
        if (typeof value !== "string") return kind(value);
        var text = value.replace(/[\r\n\t]+/g, " ").trim();
        if (classifierKeys[key] && /^[A-Za-z0-9_.:-]{1,80}$/.test(text)) return text;
        if (sensitiveKey.test(key)) return "[redacted]";
        if (/^[A-Za-z0-9_.:-]{1,80}$/.test(text)) return text;
        if (/^(?:广告|推广|赞助)$/.test(text)) return text;
        return "[string]";
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
                remember(paths, pathSeen, (path || "$") + "[]=array", 800);
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
            if (hasSignature) {
                remember(classifiers, classifierSeen, { path: path || "$", fields: signature }, 500);
            }

            for (var i = 0; i < keys.length; i++) {
                var key = keys[i], child = value[key];
                var childPath = (path ? path + "." : "") + safeKey(key);
                remember(paths, pathSeen, childPath + "=" + kind(child), 800);
                if ((adKey.test(key) || (typeof child === "string" && adValue.test(child))) &&
                        !/(?:token|cookie|session|auth)/i.test(key)) {
                    remember(findings, findingSeen, {
                        path: childPath,
                        value: safeValue(key, child)
                    }, 500);
                }
                walk(child, childPath, depth + 1);
            }
        }

        walk(body, "", 0);
        return {
            paths: paths,
            classifiers: classifiers,
            findings: findings,
            truncated: truncated
        };
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

        var parsed = JSON.parse(text);
        var method = String(request.method || "").toUpperCase();
        if (!/^(?:GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(method)) method = "";
        var record = {
            version: 1,
            capturedAt: Date.now(),
            request: { method: method, url: target.url },
            response: {
                status: status,
                contentType: contentType.slice(0, 120),
                bodyCharacters: text.length
            },
            structure: summarize(parsed)
        };
        var timer = setTimeout(function () {
            log("[知乎抓广告] 接收器超时 " + target.url);
            done();
        }, 1400);
        $httpClient.post({
            url: collector,
            headers: { "Content-Type": "application/json", "X-ZHIHU-Capture": "v1" },
            body: JSON.stringify(record),
            timeout: 1
        }, function (error, answer) {
            clearTimeout(timer);
            var code = answer && (answer.status || answer.statusCode);
            log("[知乎抓广告] " + target.url + " | " +
                (error ? "发送失败" : "已保存 " + code));
            done();
        });
    } catch (error) {
        log("[知乎抓广告] 解析失败，响应保持原样");
        done();
    }
})();
