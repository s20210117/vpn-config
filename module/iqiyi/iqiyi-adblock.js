// 接口与广告字段参考 QingRex/LoonKissSurge 的爱奇艺模块（原作者可莉）。
// 独立精简实现，仅处理明确广告字段。
(function () {
    "use strict";
    var result = {}, changes = [], endpoint = "";
    function object(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
    function positive(v) {
        return (typeof v === "number" || typeof v === "string") && Number(v) > 0;
    }
    function enabled(v) { return v === true || positive(v); }
    function remove(owner, key, label) {
        if (object(owner) && Object.prototype.hasOwnProperty.call(owner, key)) {
            delete owner[key]; changes.push(label || key);
        }
    }
    function zero(owner, key) {
        if (object(owner) && Object.prototype.hasOwnProperty.call(owner, key) && owner[key] !== 0) {
            owner[key] = 0; changes.push(key);
        }
    }
    function knownAdAlias(alias) {
        return [
            "ad_mobile_flow", "ad_trueview", "search_mid_text_ad", "play_ad_no_vip"
        ].indexOf(alias) !== -1;
    }
    function strongAdCard(card) {
        if (!object(card)) return false;
        if (knownAdAlias(card.alias_name)) return true;
        if (object(card.statistics) && positive(card.statistics.is_cupid)) return true;
        if (["ad_mobile_flow", "common_banner_ad", "immersive_focus_only_ad_newui"].indexOf(card.strategy_com_id) !== -1) return true;
        if (object(card.kv_pair) && card.kv_pair.convertor === "cupidad_card") return true;
        if (typeof card.name === "string" && card.name.indexOf("广告") !== -1) return true;
        if (Array.isArray(card.blocks)) {
            for (var i = 0; i < card.blocks.length; i++) {
                var block = object(card.blocks[i]) ? card.blocks[i] : null;
                if (object(block) && object(block.statistics) && positive(block.statistics.is_cupid)) return true;
                var other = object(block) ? block.other : null;
                if (object(other) && (
                    enabled(other.native_ad) || enabled(other.mixer_ad) || enabled(other.is_ad_block) ||
                    enabled(other.empty_ad_block) || other.convertor === "cupid_block"
                )) return true;
            }
        }
        return false;
    }
    function cleanCardArrays(node, depth) {
        if (!node || typeof node !== "object" || depth > 24) return 0;
        var removed = 0;
        Object.keys(node).forEach(function (key) {
            if (Array.isArray(node[key])) {
                node[key] = node[key].filter(function (item) {
                    var ad = object(item) && knownAdAlias(item.alias_name);
                    if (!ad && key === "cards") ad = strongAdCard(item);
                    if (ad) removed++;
                    return !ad;
                });
            }
            removed += cleanCardArrays(node[key], depth + 1);
        });
        return removed;
    }
    function pruneBlockClass(node, depth) {
        if (!node || typeof node !== "object" || depth > 24) return 0;
        var removed = 0;
        if (Array.isArray(node)) {
            for (var i = node.length - 1; i >= 0; i--) {
                var item = node[i];
                if (object(item) && Object.prototype.hasOwnProperty.call(item, "block_class")) {
                    node.splice(i, 1); removed++;
                } else {
                    removed += pruneBlockClass(item, depth + 1);
                }
            }
            return removed;
        }
        Object.keys(node).forEach(function (key) {
            var child = node[key];
            if (object(child) && Object.prototype.hasOwnProperty.call(child, "block_class")) {
                delete node[key]; removed++;
            } else {
                removed += pruneBlockClass(child, depth + 1);
            }
        });
        return removed;
    }
    try {
        var req = typeof $request === "object" ? $request : {};
        var res = typeof $response === "object" ? $response : {};
        var match = /^https?:\/\/([^/?#]+)(\/[^?#]*)(?:\?[^#]*)?$/.exec(req.url || "");
        if (match && (!req.method || req.method === "GET" || req.method === "POST")) {
            var host = match[1], path = match[2];
            if (host === "59.39.2.11" && /^http:\/\//.test(req.url)) host = "cards.iqiyi.com";
            var gateway = /^(?:access\.if\.iqiyi\.com|116\.211\.198\.237|111\.63\.147\.158|103\.44\.59\.54)$/.test(host) &&
                /^\/3f1\/(cards|comment-card)\.iqiyi\.com(\/.*)$/.exec(path);
            if (gateway) { host = gateway[1] + ".iqiyi.com"; path = gateway[2]; }
            var apiGateway = host === "api.iqiyi.com" && /^\/3f4\/iface2\.iqiyi\.com(\/.*)$/.exec(path);
            if (apiGateway) { host = "iface2.iqiyi.com"; path = apiGateway[1]; }
            var cards = host === "cards.iqiyi.com" && /^\/(?:views_home\/3\.0\/qy_home|views_category\/3\.0\/(?:category_home|categorylib_content|film_hybrid|cloud_cinema_home)|views_plt\/3\.0\/(?:player_tabs_v2|album_comic\/card_view_v2)|views_pgc\/3\.0\/pgc_dynamic_state|views_search\/3\.0\/(?:hot_query_)?search)\/?$/.test(path);
            var waterfall = host === "cards.iqiyi.com" && /^\/waterfall(?:-plt)?\/3\.0\/feed\/?$/.test(path);
            var comments = host === "comment-card.iqiyi.com" && /^\/views_comment\/3\.0\/long_video_comments\/?$/.test(path);
            var config = host === "iface2.iqiyi.com" && /^\/fusion\/3\.0\/(?:common_switch|bundle\/common)\/?$/.test(path);
            var bundleCommon = host === "iface2.iqiyi.com" && /^\/fusion\/3\.0\/bundle\/common\/?$/.test(path);
            var videoFeed = host === "iface2.iqiyi.com" && /^\/video_feed\/3\.0\/(?:profile|pre_load)\/?$/.test(path);
            var popControl = host === "iface2.iqiyi.com" && /^\/views_pop\/3\.0\/pop_control\/?$/.test(path);
            var initLogin = host === "iface2.iqiyi.com" && /^\/control\/3\.0\/init_login\/?$/.test(path);
            var mixer = /^(?:kjp|t7z)\.cupid\.iqiyi\.com$/.test(host) && /^\/mixer\/?$/.test(path);
            var status = Number(res.statusCode || res.status);
            var headers = res.headers || {};
            var ct = Object.keys(headers).filter(function (k) { return k.toLowerCase() === "content-type"; }).map(function (k) { return String(headers[k]); }).join(";");
            if ((cards || waterfall || comments || config || mixer || videoFeed || popControl || initLogin) && (!status || (status >= 200 && status < 300)) && typeof res.body === "string" && (!ct || /\b(?:application|text)\/(?:[\w.-]+\+)?json\b/i.test(ct))) {
                endpoint = host + path;
                var body = JSON.parse(res.body);
                if (object(body)) {
                    if (cards || waterfall || comments) {
                        var removedCards = waterfall ? pruneBlockClass(body, 0) : cleanCardArrays(body, 0);
                        if (removedCards) changes.push((waterfall ? "block_class 广告对象 " : "广告卡片 ") + removedCards + " 条");
                        if (object(body.base) && object(body.base.statistics)) {
                            remove(body.base.statistics, "ad_str", "base.statistics.ad_str");
                            remove(body.base.statistics, "ad_str_map", "base.statistics.ad_str_map");
                        }
                    }
                    if (config && object(body.content)) {
                        remove(body.content.resource, "cast_device_ad", "cast_device_ad");
                        var switches = body.content.switchs;
                        if (object(switches)) {
                            zero(switches.app_ad, "app_ad_enable");
                            zero(switches.app_ad, "app_ad_duration");
                            zero(switches.ios_tech, "kPreadAdHintSwitch");
                            zero(switches.ios_tech, "ad_download");
                            zero(switches.m_qiyi_ios_tech, "KFocusAdVideoPlayTimesIn4G");
                        }
                    }
                    if (bundleCommon && Array.isArray(body.bundles)) {
                        var beforeBundles = body.bundles.length;
                        body.bundles = body.bundles.filter(function (bundle) {
                            var id = object(bundle) && typeof bundle.id === "string" ? bundle.id : "";
                            return !(id.toLowerCase().indexOf("cupid") !== -1 && /ad-sw\.js/i.test(id));
                        });
                        if (body.bundles.length !== beforeBundles) changes.push("广告配置包 " + (beforeBundles - body.bundles.length) + " 条");
                    }
                    if (videoFeed && object(body.data) && Array.isArray(body.data.feeds)) {
                        var beforeFeeds = body.data.feeds.length;
                        body.data.feeds = body.data.feeds.filter(function (feed) {
                            return !(object(feed) && (positive(feed.adPs) || positive(feed.adOccupied)));
                        });
                        if (body.data.feeds.length !== beforeFeeds) changes.push("短视频广告 " + (beforeFeeds - body.data.feeds.length) + " 条");
                    }
                    if (popControl && Array.isArray(body.control_items)) {
                        var beforeControls = body.control_items.length;
                        body.control_items = body.control_items.filter(function (item) {
                            var other = object(item) ? item.other : null;
                            var reward = object(other) && typeof other.login_reward_url === "string" ? other.login_reward_url : "";
                            return !(object(other) && (enabled(other.pause_ad) || /\/views_pop\/3\.0\/component\/sales_promotion(?:_degrade)?(?:[/?#]|$)/i.test(reward)));
                        });
                        if (body.control_items.length !== beforeControls) changes.push("暂停广告控制项 " + (beforeControls - body.control_items.length) + " 条");
                    }
                    if (initLogin && object(body.content)) remove(body.content, "ad_info", "content.ad_info");
                    if (mixer) remove(body, "adSlots");
                    if (changes.length) result = { body: JSON.stringify(body) };
                    if (!changes.length) {
                        var shape = ["data", "cards", "content", "switchs", "bundles", "control_items", "adSlots"].filter(function (key) {
                            return Object.prototype.hasOwnProperty.call(body, key);
                        }).map(function (key) {
                            var v = body[key];
                            return key + "=" + (Array.isArray(v) ? "array(" + v.length + ")" : v === null ? "null" : typeof v);
                        });
                        changes.push("未发现可处理广告字段；结构 " + (shape.join(",") || "未知"));
                    }
                }
            }
        }
    } catch (error) {
        result = {}; changes = ["解析异常，保留原响应"];
    }
    try {
        if (endpoint && !(typeof $argument === "string" && /(?:^|&)debug=false(?:&|$)/i.test($argument))) {
            console.log("[爱奇艺去广告] " + endpoint + " | " + (changes.length ? changes.join("、") : "未发现可处理广告字段"));
        }
    } catch (error) {}
    $done(result);
})();
