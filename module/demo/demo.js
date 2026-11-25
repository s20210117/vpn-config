// 用于 Clash-Client「覆写脚本」入口。
// 新增一个演示策略组，不改变已有节点、DNS 或分流规则。
function main(config) {
    var name = "覆写 Demo";
    if (!Array.isArray(config["proxy-groups"])) {
        config["proxy-groups"] = [];
    }

    var exists = config["proxy-groups"].some(function (group) {
        return group && group.name === name;
    });
    if (!exists) {
        config["proxy-groups"].push({
            name: name,
            type: "select",
            proxies: ["DIRECT"]
        });
    }
    return config;
}
