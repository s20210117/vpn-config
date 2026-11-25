#!/usr/bin/env node
"use strict";

// 在本机提供最小的客户端脚本 API，运行真实的 module.js 并打印演示结果。
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const manifest = fs.readFileSync(path.join(__dirname, "demo.sgmodule"), "utf8");
const declaration = manifest.split(/\r?\n/).find(line => line.startsWith("demo-hello = "));
if (!declaration) throw new Error("模块中缺少 demo-hello 声明");
const options = Object.fromEntries(declaration.split(" = ")[1].split(/,\s*/).map(item => {
    const equals = item.indexOf("=");
    return [item.slice(0, equals), item.slice(equals + 1)];
}));
if (options.type !== "http-request") throw new Error("示例需要 http-request 类型");

const url = process.argv[2] || "http://module-demo.invalid/hello";
const matched = new RegExp(options.pattern).test(url);
let doneCalls = 0;
let result = null;
if (matched) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "module.js"), "utf8"), {
        $request: { url, method: "GET", headers: {} },
        $done(value) {
            if (++doneCalls > 1) throw new Error("脚本重复调用 $done");
            result = JSON.parse(JSON.stringify(value));
        }
    }, { filename: "module.js", timeout: 1000 });
    if (doneCalls !== 1) throw new Error("脚本没有调用 $done");
}

const report = {
    environment: "Node.js 模拟客户端脚本 API，非手机实测",
    module: "demo.sgmodule",
    url,
    matched,
    doneCalls,
    response: result && result.response ? {
        status: result.response.status,
        headers: result.response.headers,
        body: JSON.parse(result.response.body)
    } : null
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
