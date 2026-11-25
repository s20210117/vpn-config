// 客户端模块脚本：$request 由客户端提供，$done 用于返回处理结果。
(function () {
    "use strict";

    var pattern = /^http:\/\/module-demo\.invalid\/hello(?:\?.*)?$/;
    if (typeof $request !== "object" || !pattern.test($request.url || "")) {
        $done({});
        return;
    }

    try {
        if (!(typeof $argument === "string" && /(?:^|&)debug=false(?:&|$)/i.test($argument))) {
            console.log("[模块] 已返回演示 JSON");
        }
    } catch (error) {}

    $done({
        response: {
            status: 200,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            },
            body: JSON.stringify({
                message: "模块和脚本运行成功",
                module: "模块",
                script: "module.js",
                request: $request.url
            }, null, 2)
        }
    });
})();
