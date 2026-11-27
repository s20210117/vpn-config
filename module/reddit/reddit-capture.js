// 仅记录 GraphQL 字段结构、类型和数组数量，不修改响应。
(function () {
    "use strict";

    var collector = "", finished = false, timer = null;
    var debug = !(typeof $argument === "string" && /(?:^|&)debug=false(?:&|$)/i.test($argument));
    if (typeof $argument === "string") {
        var configured = /(?:^|&)collector=([^&]*)/.exec($argument);
        if (configured) {
            try { collector = decodeURIComponent(configured[1]); } catch (error) {}
        }
    }

    function done() {
        if (!finished) {
            finished = true;
            if (timer !== null) clearTimeout(timer);
            $done({});
        }
    }

    function log(message) {
        if (debug) {
            try { console.log("[Reddit抓广告] " + message); } catch (error) {}
        }
    }

    function summarize(body) {
        var paths = [], seen = Object.create(null), arrays = [], types = Object.create(null);
        var nodes = 0, truncated = false;
        function walk(value, path, depth) {
            if (nodes++ >= 12000 || depth > 24) { truncated = true; return; }
            var kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
            var signature = path + "=" + kind;
            if (!seen[signature]) {
                if (paths.length < 800) { paths.push(signature); seen[signature] = true; }
                else truncated = true;
            }
            if (Array.isArray(value)) {
                if (arrays.length < 300) arrays.push({ path: path, length: value.length });
                else truncated = true;
                for (var i = 0; i < value.length; i++) {
                    if (nodes >= 12000) { truncated = true; break; }
                    walk(value[i], path + "[]", depth + 1);
                }
            } else if (value && typeof value === "object") {
                var type = value.__typename;
                if (typeof type === "string" && /^[A-Z][A-Za-z0-9_]{0,79}$/.test(type)) {
                    if (Object.prototype.hasOwnProperty.call(types, type)) types[type]++;
                    else if (Object.keys(types).length < 200) types[type] = 1;
                    else truncated = true;
                }
                var keys = Object.keys(value);
                for (var ki = 0; ki < keys.length; ki++) {
                    if (nodes >= 12000) { truncated = true; break; }
                    var key = keys[ki];
                    var safe = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : ":key";
                    walk(value[key], path + "." + safe, depth + 1);
                }
            }
        }
        walk(body, "$", 0);
        return { paths: paths, arrays: arrays, types: types, truncated: truncated };
    }

    try {
        var request = typeof $request === "object" && $request ? $request : {};
        var response = typeof $response === "object" && $response ? $response : {};
        var target = /^https:\/\/(gql(?:-fed)?\.reddit\.com)(?::443)?\/(?:\?[^#]*)?$/i.exec(request.url || "");
        if (!target) return done();
        var text = typeof response.body === "string" ? response.body : "";
        var status = Number(response.statusCode || response.status || 0);
        var structure = { paths: [], arrays: [], types: {}, truncated: false };
        var format = "empty";
        if (text) {
            try { structure = summarize(JSON.parse(text)); format = "json"; }
            catch (error) { format = "non-json"; }
        }
        var method = String(request.method || "").toUpperCase();
        if (!/^(?:GET|POST|HEAD)$/.test(method)) method = "";
        var record = {
            version: 1,
            capturedAt: Date.now(),
            request: { method: method, url: "https://" + target[1].toLowerCase() + "/" },
            response: { status: status, format: format, bodyCharacters: text.length },
            structure: structure
        };
        log(target[1].toLowerCase() + " | HTTP " + status + " | " + format +
            " | AdPost=" + (structure.types.AdPost || 0) +
            " AdMetadataCell=" + (structure.types.AdMetadataCell || 0) +
            (structure.truncated ? " | 结构已截断" : ""));
        if (!/^https?:\/\/[^/?#\s]+\/[^#\s]*$/i.test(collector)) return done();
        timer = setTimeout(function () {
            log("接收器超时");
            done();
        }, 1400);
        $httpClient.post({
            url: collector,
            headers: { "Content-Type": "application/json", "X-REDDIT-Capture": "v1" },
            body: JSON.stringify(record),
            timeout: 1
        }, function (error, answer) {
            var code = answer && (answer.status || answer.statusCode);
            log(error ? "发送失败" : "接收器 HTTP " + code);
            done();
        });
    } catch (error) {
        log("诊断异常，响应保持原样");
        done();
    }
})();
