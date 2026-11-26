"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const moduleText = fs.readFileSync(
    path.join(__dirname, "../module/huya/huya-adblock.sgmodule"),
    "utf8",
);

function rewritePatterns() {
    return moduleText.split(/\r?\n/)
        .filter(line => line.startsWith("^"))
        .map(line => new RegExp(line.split(" - ")[0]));
}

test("publishes the complete Huya module metadata", () => {
    assert.match(moduleText, /^#!name=虎牙去广告$/m);
    assert.match(moduleText, /^#!author=codex$/m);
    assert.match(moduleText, /^#!type=$/m);
    assert.match(moduleText, /^#!version=1\.0\.7$/m);
    assert.match(moduleText, /^#!date=2026-11-26$/m);
    assert.match(moduleText, /^#!tag=虎牙去广告$/m);
    assert.match(moduleText, /^#!category=去广告$/m);
});

test("matches only the verified Huya ad entrances", () => {
    const patterns = rewritePatterns();
    for (const url of [
        "https://business.msstatic.com/advertiser/material?platform=ios",
        "https://business.msstatic.com/advertiser/config?platform=ios",
        "https://business.msstatic.com/dsp/public/sdkconfig.xml",
        "https://cdnfile1.msstatic.com/cdnfile/appad/splash.jpg",
        "https://live-ads.huya.com/live/getAllEntrance?room=1",
        "https://zt.huya.com/8cc59b08/mobile/index.html",
        "https://zt.huya.com/a215cf20/mobile/index.html?halfscreen=1",
        "https://zt.huya.com/8bec7583/mobile/index.html",
    ]) assert.ok(patterns.some(pattern => pattern.test(url)), url);

    for (const url of [
        "https://cdn.wup.huya.com/launch/queryHttpDns",
        "https://cdn.wup.huya.com/live/play",
        "https://business.msstatic.com/account/profile",
        "https://business.msstatic.com/dsp/public/normal.xml",
        "https://cdnfile1.msstatic.com/cdnfile/avatar/user.jpg",
        "https://live-ads.huya.com/live/getEntranceStatus",
        "https://api.huya.com/live/getAllEntrance",
        "https://zt.huya.com/other/mobile/index.html",
        "https://zt.huya.com/8cc59b08/mobile/rule.html",
        "https://zt.huya.com/8bec7583/mobile/rule.html",
    ]) assert.equal(patterns.some(pattern => pattern.test(url)), false, url);
});

test("blocks only the observed startup and third-party ad hosts at domain level", () => {
    const exactBlockedHosts = [
        "livewebbs2pcdn.msstatic.com",
        "pp-cdnfile2pcdn.msstatic.com",
        "huyafile.msstatic.com",
        "api-access.pangolin-sdk-toutiao.com",
        "sf3-fe-tos.pglstatp-toutiao.com",
        "pgdt.gtimg.cn",
        "tangram.e.qq.com",
        "us.l.qq.com",
    ];
    const suffixBlockedHosts = [
        "v1d.szbdyd.com",
        "3dm.huya.com",
    ];
    assert.match(moduleText, /^\[Rule\]$/m);
    for (const host of exactBlockedHosts) {
        const escapedHost = host.replace(/\./g, "\\.");
        assert.match(moduleText, new RegExp(`^DOMAIN,${escapedHost},REJECT$`, "m"));
    }
    for (const host of suffixBlockedHosts) {
        const escapedHost = host.replace(/\./g, "\\.");
        assert.match(moduleText, new RegExp(`^DOMAIN-SUFFIX,${escapedHost},REJECT$`, "m"));
    }
    assert.equal(
        (moduleText.match(/^DOMAIN(?:-SUFFIX)?,/gm) || []).length,
        exactBlockedHosts.length + suffixBlockedHosts.length,
    );
    assert.doesNotMatch(moduleText, /^DOMAIN(?:-SUFFIX)?,livewebbs2\.msstatic\.com,REJECT$/m);
    for (const host of [
        "cdn.wup.huya.com",
        "wup.huya.com",
        "wsapi.huya.com",
        "api-access.pangolin-sdk-toutiao1.com",
        "p.l.qq.com",
        "sdkreport.e.qq.com",
    ]) {
        const escapedHost = host.replace(/\./g, "\\.");
        assert.doesNotMatch(moduleText, new RegExp(`^DOMAIN(?:-SUFFIX)?,${escapedHost},`, "m"));
    }
    assert.doesNotMatch(moduleText, /^\[Script\]$/m);
});

test("forces only the verified ad hosts through the HTTP engine", () => {
    assert.match(moduleText, /^force-http-engine-hosts = business\.msstatic\.com, cdnfile1\.msstatic\.com, live-ads\.huya\.com, zt\.huya\.com$/m);
    assert.match(moduleText, /^hostname = %APPEND% business\.msstatic\.com, cdnfile1\.msstatic\.com, live-ads\.huya\.com, zt\.huya\.com$/m);
    const general = moduleText.split("[General]")[1].split("[Rule]")[0];
    assert.doesNotMatch(general, /cdn\.wup\.huya\.com/);
    const mitm = moduleText.split("[MITM]")[1];
    assert.doesNotMatch(mitm, /cdn\.wup\.huya\.com/);
});

test("keeps Huya P2P playback domains out of the merged ad rules", () => {
    const exclusions = fs.readFileSync(
        path.join(__dirname, "../inputs/false-positive-exclusions.txt"),
        "utf8",
    );
    assert.match(exclusions, /^\+\.p2p\.huya\.com$/m);
});
