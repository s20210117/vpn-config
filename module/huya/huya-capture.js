// 临时诊断脚本：只记录脱敏后的 JSON 结构，不修改虎牙响应。
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
    var classifierKeys = {
        type: 1, object_type: 1, objectType: 1, card_type: 1, cardType: 1,
        item_type: 1, itemType: 1, content_type: 1, contentType: 1,
        business_type: 1, businessType: 1, biz_type: 1, bizType: 1,
        layout_type: 1, layoutType: 1, ad_type: 1, adType: 1,
        banner_type: 1, bannerType: 1, slot_type: 1, slotType: 1,
        module_type: 1, moduleType: 1, style: 1
    };
    var sensitiveKey = /(?:token|auth|cookie|session|passport|account|phone|email|device|user|uid|uuid|member|name|title|content|text|excerpt|description|headline|avatar|image|video|url|uri|link|tracking|trace|request_id|response_id|(?:^|_)id$)/i;
    var adKey = /(?:^|_)(?:ad|ads|advert|advertise|advertisement|commercial|marketing|promotion|promote|sponsor|sponsored|brand|banner|slot)(?:_|$)|^(?:ad[A-Z]|adinfo$)/;
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

    function allowedHost(host) {
        return host === "business.msstatic.com" ||
            host === "cdnfile1.msstatic.com" ||
            host === "live-ads.huya.com" ||
            host === "dataservice.cdn.huya.com" ||
            host === "diy-front.cdn.huya.com" ||
            host === "df.huya.com" ||
            host === "zt.huya.com" ||
            host === "us.l.qq.com" ||
            host === "tangram.e.qq.com" ||
            host === "api-access.pangolin-sdk-toutiao.com" ||
            host === "pgdt.gtimg.cn" ||
            host === "sf3-fe-tos.pglstatp-toutiao.com" ||
            host === "livewebbs2.msstatic.com" ||
            host === "livewebbs2pcdn.msstatic.com" ||
            host === "qn-livewebbs2pcdn.msstatic.com" ||
            host === "pp-cdnfile2pcdn.msstatic.com" ||
            host === "huyafile.msstatic.com" ||
            host === "v1d.szbdyd.com" ||
            host === "3dm.huya.com" ||
            host === "sdkconf.msstatic.com" ||
            host === "cdnfile2.msstatic.com" ||
            host === "s1-static.msstatic.com" ||
            host === "short.msstatic.com" ||
            host === "zt.msstatic.com" ||
            host === "cdnfile.huya.com" ||
            host === "business-qnpcdn.msstatic.com" ||
            host === "hd.huya.com" ||
            host === "huyapreloadweb.cdn.huya.com" ||
            host === "huyaextweb.cdn.huya.com" ||
            host === "y2261a742d6a43b3-gtc5tz7i.ext.huya.com" ||
            host === "y2261a742d6a43b3-v35epxya.ext.huya.com" ||
            host === "y2261a742d6a43b3-sbn47atc.ext.huya.com" ||
            host === "diy-assets.msstatic.com" ||
            host === "hyext-sdk.msstatic.com" ||
            host === "fileserver.cdn.huya.com";
    }

    function endpoint(value) {
        var match = /^(https?):\/\/([^/:?#]+)(?::\d+)?(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/.exec(value || "");
        if (!match || !allowedHost(match[2].toLowerCase())) return null;
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
        if (typeof value === "number") return sensitiveKey.test(key) ? "[redacted]" : value;
        if (typeof value !== "string") return kind(value);
        var text = value.replace(/[\r\n\t]+/g, " ").trim();
        if (classifierKeys[key] && /^[A-Za-z0-9_.:-]{1,80}$/.test(text)) return text;
        if (sensitiveKey.test(key)) return "[redacted]";
        if (/^(?:广告|推广|赞助)$/.test(text)) return text;
        if (/^[A-Za-z0-9_.:-]{1,80}$/.test(text)) return text;
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
        var declaredLength = header(response.headers, "content-length");
        var text = typeof response.body === "string" ? response.body : "";
        var trimmed = text.replace(/^\s+/, "");
        if (!target || (status && (status < 200 || status >= 300))) {
            return done();
        }

        if (!/^https?:\/\/[^/?#\s]+\/[^#\s]*$/i.test(collector)) {
            log("[虎牙抓广告] 请设置 collector 接收地址，响应保持原样");
            return done();
        }
        var structure = { format: text ? "non-json" : "empty" };
        if (text && (/\bjson\b/i.test(contentType) ||
                trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[")) {
            try {
                structure = summarize(JSON.parse(text));
            } catch (parseError) {
                structure = { format: "invalid-json" };
            }
        }
        var method = String(request.method || "").toUpperCase();
        if (!/^(?:GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(method)) method = "";
        var record = {
            version: 1,
            capturedAt: Date.now(),
            request: { method: method, url: target.url },
            response: {
                status: status,
                contentType: contentType.slice(0, 120),
                contentLength: /^\d+$/.test(declaredLength) ? Number(declaredLength) : text.length,
                bodyCharacters: text.length
            },
            structure: structure
        };
        var timer = setTimeout(function () {
            log("[虎牙抓广告] 接收器超时 " + target.url);
            done();
        }, 1400);
        $httpClient.post({
            url: collector,
            headers: { "Content-Type": "application/json", "X-HUYA-Capture": "v1" },
            body: JSON.stringify(record),
            timeout: 1
        }, function (error, answer) {
            clearTimeout(timer);
            var code = answer && (answer.status || answer.statusCode);
            log("[虎牙抓广告] " + target.url + " | " +
                (error ? "发送失败" : "已保存 " + code));
            done();
        });
    } catch (error) {
        log("[虎牙抓广告] 解析失败，响应保持原样");
        done();
    }
})();
