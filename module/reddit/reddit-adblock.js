// Reddit GraphQL 广告结构参考：
// https://gist.github.com/srcreigh/2bc8687aace702698d4b8b0b51637bc5
(function () {
    "use strict";

    var debug = !(typeof $argument === "string" && /(?:^|&)debug=false(?:&|$)/i.test($argument));
    var removed = 0, comments = 0, feeds = 0, result = {}, reason = "";

    function object(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function advert(edge) {
        if (!object(edge) || !object(edge.node)) return false;
        var node = edge.node;
        if (node.__typename === "AdPost") return true;
        return Array.isArray(node.cells) && node.cells.some(function (cell) {
            return object(cell) && cell.__typename === "AdMetadataCell";
        });
    }

    function clean(envelope) {
        if (!object(envelope) || !object(envelope.data)) return;
        var data = envelope.data;
        ["homeV3", "subredditV3", "popularV3", "newsV3", "home"].forEach(function (key) {
            var feed = data[key];
            if (!object(feed) || !object(feed.elements) || !Array.isArray(feed.elements.edges)) return;
            feeds++;
            var before = feed.elements.edges;
            var after = before.filter(function (edge) { return !advert(edge); });
            if (after.length !== before.length) {
                removed += before.length - after.length;
                feed.elements.edges = after;
            }
        });
        var post = data.postInfoById;
        var ads = object(post) && post.pdpCommentsAds;
        if (object(ads) && Array.isArray(ads.adPosts) && ads.adPosts.length) {
            comments += ads.adPosts.length;
            ads.adPosts = [];
        }
    }

    try {
        var request = typeof $request === "object" && $request ? $request : {};
        var response = typeof $response === "object" && $response ? $response : {};
        var status = Number(response.statusCode || response.status || 0);
        if (!/^https:\/\/gql(?:-fed)?\.reddit\.com(?::443)?\/(?:\?[^#]*)?$/i.test(request.url || "")) {
            reason = "接口不在处理范围";
        } else if (status && (status < 200 || status >= 300)) {
            reason = "HTTP " + status + "，保留原响应";
        } else if (typeof response.body !== "string" || !response.body) {
            reason = "没有响应正文";
        } else {
            var body = JSON.parse(response.body);
            if (Array.isArray(body)) body.forEach(clean);
            else clean(body);
            if (removed || comments) result = { body: JSON.stringify(body) };
            else reason = feeds ? "未发现明确广告" : "未命中已知广告结构";
        }
    } catch (error) {
        result = {};
        reason = "解析异常，保留原响应";
    }
    if (debug) {
        try {
            console.log("[Reddit去广告 1.0.0] 信息流 " + removed + " 条，评论区 " + comments + " 条" +
                (reason ? " | " + reason : ""));
        } catch (error) {}
    }
    $done(result);
})();
