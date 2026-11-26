"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.js'), 'utf8');
function run(url, body, options = {}) {
    let result, calls = 0; const logs = [];
    vm.runInNewContext(source, {
        $request: { url, method: 'GET', ...options.request },
        $response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body), ...options.response },
        $argument: options.argument,
        console: { log: x => logs.push(x) },
        $done: x => { calls++; result = JSON.parse(JSON.stringify(x)); }
    }, { timeout: 1000 });
    assert.equal(calls, 1);
    return { result, logs };
}
const cardURL = 'https://cards.iqiyi.com/views_home/3.0/qy_home?token=PRIVATE';
test('filters only known advertising cards, preserving focus, unknown content, metadata and membership', () => {
    const keep = [{ alias_name: 'focus' }, { alias_name: 'normal_video' }, { alias_name: 'new_unknown' }, null];
    const body = { cards: [...keep, { alias_name: 'ad_trueview' }, { alias_name: 'ad_mobile_flow' }], base: { statistics: { ad_str: 'AD', ad_str_map: { private: 'AD' }, normal: 1 } }, vip: false };
    const { result, logs } = run(cardURL, body);
    assert.deepEqual(JSON.parse(result.body), { ...body, cards: keep, base: { statistics: { normal: 1 } } });
    assert.ok(!logs.join('').includes('PRIVATE'));
    assert.equal(body.cards.length, 6);
});
test('sets existing advertising switches only, preserving playback and account settings', () => {
    const body = { content: { resource: { cast_device_ad: {}, normal: 1 }, switchs: { app_ad: { app_ad_enable: 1, app_ad_duration: 15, normal: 2 }, ios_tech: { ad_download: 1, playback: 1 } } }, account: { vip: false } };
    const result = JSON.parse(run('https://iface2.iqiyi.com/fusion/3.0/common_switch', body).result.body);
    assert.equal(result.content.switchs.app_ad.app_ad_enable, 0);
    assert.equal(result.content.switchs.app_ad.app_ad_duration, 0);
    assert.equal(result.content.switchs.ios_tech.ad_download, 0);
    assert.equal(result.content.switchs.ios_tech.playback, 1);
    assert.deepEqual(result.account, body.account);
    assert.deepEqual(result.content.resource, { normal: 1 });
});
test('removes player adSlots while retaining other player response fields', () => {
    for (const host of ['kjp', 't7z']) {
        const body = { adSlots: [{ id: 'advert' }], code: 0, data: { playback: 'keep' } };
        assert.deepEqual(JSON.parse(run(`https://${host}.cupid.iqiyi.com/mixer?x=1`, body).result.body), { code: 0, data: body.data });
    }
});
test('passes through unknown routes, unknown schemas and responses without adverts', () => {
    for (const url of [cardURL, 'https://cards.iqiyi.com/unknown', 'https://cards.iqiyi.com.evil.test/views_home/3.0/qy_home']) {
        assert.deepEqual(run(url, { unknown: 1 }).result, {});
    }
    assert.deepEqual(run(cardURL, { cards: [{ alias_name: 'normal' }] }).result, {});
});
test('fails open on invalid JSON, HTTP errors, HTML and unsupported methods; debug can be disabled', () => {
    assert.deepEqual(run(cardURL, '{bad').result, {});
    for (const response of [{ status: 403 }, { headers: { 'content-type': 'text/html' } }]) {
        assert.deepEqual(run(cardURL, { cards: [{ alias_name: 'ad_trueview' }] }, { response }).result, {});
    }
    assert.deepEqual(run(cardURL, { cards: [{ alias_name: 'ad_trueview' }] }, { request: { method: 'PUT' } }).result, {});
    assert.deepEqual(run(cardURL, { cards: [] }, { argument: 'debug=false' }).logs, []);
});

test('comment endpoint removes explicit advert aliases while preserving ordinary content', () => {
    const keep = [{ alias_name: 'video' }, { content: 'ordinary comment' }, { alias_name: 'focus' }];
    const body = { cards: [...keep, { alias_name: 'ad_trueview' }], paging: { next: 'keep' } };
    const url = 'https://comment-card.iqiyi.com/views_comment/3.0/long_video_comments?x=1';
    assert.deepEqual(JSON.parse(run(url, body).result.body), { ...body, cards: keep });
});

test('waterfall pages use the public block_class pruning behavior and preserve pagination metadata', () => {
    const url = 'https://cards.iqiyi.com/waterfall/3.0/feed?pg_num=2';
    const advert = { alias_name: 'waterfall', statistics: { is_cupid: 2 }, blocks: [{ block_class: 'base_block_waterfall_h1_class', other: { native_ad: 1 } }] };
    const normal = { alias_name: 'waterfall_short_sideslip', statistics: { is_cupid: 0 }, blocks: [{ title: 'keep' }] };
    const body = { cards: [advert, normal], base: { has_next: 1, next_url: url, statistics: { ad_str: 'remove', ad_str_map: { key: 'remove' }, normal: 1 } } };
    assert.deepEqual(JSON.parse(run(url, body, { request: { method: 'POST' } }).result.body), {
        cards: [{ ...advert, blocks: [] }, normal],
        base: { has_next: 1, next_url: url, statistics: { normal: 1 } }
    });

    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    const patterns = manifest.split('\n').filter(x => x.includes('type=http-response')).map(x => new RegExp(x.match(/pattern=(.*?), requires-body/)[1]));
    assert.ok(patterns.some(x => x.test(url)));
    assert.ok(patterns.some(x => x.test('https://cards.iqiyi.com/waterfall-plt/3.0/feed?pg_num=2')));
});

test('waterfall advert-only pages match the public empty-block result without changing pagination fields', () => {
    const url = 'https://cards.iqiyi.com/waterfall/3.0/feed?pg_num=7';
    const body = {
        cards: [{
            id: 'keep-for-pagination', alias_name: 'waterfall', card_type: 52, strategy_com_id: 'common_banner_ad', name: '视频广告',
            statistics: { is_cupid: 2, ad_flag: true, ad_type: 'native_video', ad_str_key: 'private', vv: { position: '7' } },
            kv_pair: { adConfigInfo: '{}', default_ad_interval: '8', default_ad_fp: '4', is_block_filter_empty_ad: '1', layout: 'keep' },
            blocks: [{
                block_id: 'layout-only', block_type: 959, block_class: 'base_block_waterfall_h1_class',
                block_component: 'waterfall_ad', block_name: '信息流广告', show_control: { preload_key: 'layout', nested: { remove: true } },
                images: [{ url: 'advert.jpg' }], videos: [{ url: 'advert.mp4' }], metas: [{ text: 'advert' }],
                buttons: [{ text: 'open' }], actions: { click_event: { url: 'advert' } }, statistics: { is_cupid: 1 },
                other: { mixer_ad: 1, pictureRatio: '1.78', needFixHeight: '1' }, native_ext: { advert: true }
            }]
        }],
        base: { has_next: 1, next_url: url, statistics: { ad_str: 'remove', ad_str_map: { private: true } } },
        paging: { cursor: 'keep' }
    };
    const output = JSON.parse(run(url, body, { request: { method: 'POST' } }).result.body);
    assert.equal(output.cards.length, 1);
    assert.deepEqual(output.cards[0], {
        id: 'keep-for-pagination', alias_name: 'waterfall', card_type: 52, strategy_com_id: 'common_banner_ad', name: '视频广告',
        statistics: body.cards[0].statistics,
        kv_pair: body.cards[0].kv_pair,
        blocks: []
    });
    assert.deepEqual(output.base, { has_next: 1, next_url: url, statistics: {} });
    assert.deepEqual(output.paging, { cursor: 'keep' });
});

test('mixer local reject precedes upstream rewrites and excludes tracking, neighbours and playback APIs', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    const line = manifest.split('\n').find(x => x.includes('/mixer/') && x.endsWith(' - reject-dict'));
    assert.ok(manifest.indexOf(line) < manifest.indexOf(' header'));
    const pattern = new RegExp(line.split(' ')[0]);
    for (const url of ['https://t7z.cupid.iqiyi.com/mixer?token=a', 'http://kjp.cupid.iqiyi.com/mixer']) assert.ok(pattern.test(url));
    for (const url of ['https://t7z.cupid.iqiyi.com/mixer_other', 'https://t7z.cupid.iqiyi.com/track2', 'https://cache.video.iqiyi.com/mixer', 'https://t7z.cupid.iqiyi.com.evil.test/mixer']) assert.equal(pattern.test(url), false);
});

test('observed mixed recommendations are not intercepted without confirmed advertising fields', () => {
    const body = { data: { rows: [{ items: [{ alias_name: 'ad_trueview' }, { alias_name: 'film', title: 'ordinary' }, { content: 'normal comment' }] }] }, cursor: 'keep' };
    const url = 'https://iface2.iqiyi.com/aggregate/3.0/mix_touch_rec?token=PRIVATE';
    assert.deepEqual(run(url, body, { request: { method: 'POST' } }).result, {});
});

test('bundle common only changes recognized advertising switches and logs unknown structures safely', () => {
    const url = 'https://iface2.iqiyi.com/fusion/3.0/bundle/common';
    const body = { content: { switchs: { app_ad: { app_ad_enable: 1 }, other: { enabled: 1 } } } };
    assert.deepEqual(JSON.parse(run(url, body).result.body), { content: { switchs: { app_ad: { app_ad_enable: 0 }, other: { enabled: 1 } } } });
    const output = run(url, { data: { private: 'SECRET' }, member: 'PRIVATE' });
    assert.deepEqual(output.result, {});
    assert.match(output.logs.join(''), /data=object/);
    assert.doesNotMatch(output.logs.join(''), /SECRET|PRIVATE|private|member/);
});

test('filters observed short-video adverts by adPs or adOccupied and retains ordinary feeds', () => {
    const body = {
        data: {
            feeds: [
                { id: 'normal-zero', adPs: 0, adOccupied: '0', adParams: { keep: true } },
                { id: 'normal-absent', title: 'ordinary' },
                { id: 'advert-ps', adPs: 2049 },
                { id: 'advert-occupied', adPs: 0, adOccupied: '2' }
            ],
            videoConfig: { adRps: 1, playback: 'keep' }
        },
        account: { vip: false }
    };
    const expected = { ...body, data: { ...body.data, feeds: body.data.feeds.slice(0, 2) } };
    assert.deepEqual(JSON.parse(run('https://iface2.iqiyi.com/video_feed/3.0/profile', body).result.body), expected);
    assert.deepEqual(
        JSON.parse(run('https://iface2.iqiyi.com/video_feed/3.0/pre_load', body, { request: { method: 'POST' } }).result.body),
        expected
    );
});

test('filters only observed pause-ad controls and exact sales-promotion control URLs', () => {
    const keep = [
        { id: 'normal', other: { pause_ad: 0, login_reward_url: 'https://iface2.iqiyi.com/views_pop/3.0/component/perception' } },
        { id: 'near-match', other: { login_reward_url: 'https://iface2.iqiyi.com/views_pop/3.0/component/sales_promotion_extra' } }
    ];
    const body = {
        control_items: [
            ...keep,
            { id: 'pause', other: { pause_ad: '1' } },
            { id: 'promotion', other: { login_reward_url: 'http://iface2.iqiyi.com/views_pop/3.0/component/sales_promotion' } },
            { id: 'degrade', other: { login_reward_url: 'https://iface2.iqiyi.com/views_pop/3.0/component/sales_promotion_degrade?x=1' } }
        ],
        vip: { keep: true }
    };
    assert.deepEqual(JSON.parse(run('https://iface2.iqiyi.com/views_pop/3.0/pop_control', body).result.body), { control_items: keep, vip: body.vip });
});

test('init login removes ad_info only and preserves membership and account state', () => {
    const body = {
        content: {
            ad_info: { ad_strategy: 0, private: 'remove' },
            recall_before_patch: { before_patch_free_ad: 0 },
            switch: { app_behiver: { mini_pause_ad: 0, cupid_material: 0, cupid_video_duration: 6 } },
            identity: { cupid_uid: 'keep' },
            vip: { status: 0 }
        }
    };
    const expected = JSON.parse(JSON.stringify(body));
    delete expected.content.ad_info;
    assert.deepEqual(JSON.parse(run('https://iface2.iqiyi.com/control/3.0/init_login', body).result.body), expected);
});

test('bundle common removes only the captured cupid ad service worker on direct and API gateway routes', () => {
    const ad = { id: 'webview-offline-https%3A%2F%2Fstatic.iqiyi.com%2Fext%2Fcupid%2Flp%2Fad-sw.js' };
    const keep = [{ id: 'normal-ui.js' }, { id: 'cupid-player.js' }, { id: 'normal-ad-sw.js' }];
    const body = { code: 0, bundles: [ad, ...keep], bundle_uptime: 1 };
    for (const url of [
        'https://iface2.iqiyi.com/fusion/3.0/bundle/common',
        'https://api.iqiyi.com/3f4/iface2.iqiyi.com/fusion/3.0/bundle/common'
    ]) {
        assert.deepEqual(JSON.parse(run(url, body).result.body), { code: 0, bundles: keep, bundle_uptime: 1 });
    }
});

test('newly observed card paths use the same precise card filter', () => {
    for (const url of [
        'https://cards.iqiyi.com/views_category/3.0/cloud_cinema_home',
        'https://cards.iqiyi.com/views_plt/3.0/album_comic/card_view_v2',
        'https://cards.iqiyi.com/views_pgc/3.0/pgc_dynamic_state'
    ]) {
        const body = { cards: [{ statistics: { is_cupid: 2 } }, { alias_name: 'film', block_class: 'normal-layout' }] };
        assert.deepEqual(JSON.parse(run(url, body).result.body), { cards: [body.cards[1]] }, url);
    }
});

test('manifest covers observed APIs and no longer intercepts unrelated cards-css theme requests', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    const patterns = manifest.split('\n').filter(x => x.includes('type=http-response')).map(x => new RegExp(x.match(/pattern=(.*?), requires-body/)[1]));
    for (const url of [
        'https://iface2.iqiyi.com/fusion/3.0/bundle/common?x=1',
        'https://api.iqiyi.com/3f4/iface2.iqiyi.com/fusion/3.0/bundle/common?x=1',
        'https://iface2.iqiyi.com/video_feed/3.0/profile?x=1',
        'https://iface2.iqiyi.com/video_feed/3.0/pre_load?x=1',
        'https://iface2.iqiyi.com/views_pop/3.0/pop_control?x=1',
        'https://iface2.iqiyi.com/control/3.0/init_login?x=1'
    ]) assert.ok(patterns.some(x => x.test(url)), url);
    assert.equal(patterns.some(x => x.test('https://iface2.iqiyi.com/aggregate/3.0/mix_touch_rec?x=1')), false);
    assert.doesNotMatch(manifest, /cards-css/);
    assert.deepEqual(run('https://cards-css.iqiyi.com/css_layout/3.0/package_theme', { cards: [{ alias_name: 'ad_trueview' }] }).result, {});
});

test('manifest publishes the public block_class implementation as version 1.0.12', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    assert.match(manifest, /^#!version=1\.0\.12$/m);
    assert.match(manifest, /^#!date=2026-11-25$/m);
    assert.match(manifest, /^#!author=codex$/m);
});

test('watch-history and subscription false positives are fixed in the ad provider, not bypassed by routing', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    const config = fs.readFileSync(path.join(__dirname, '../subscription/config.yaml'), 'utf8');
    const exclusions = fs.readFileSync(path.join(__dirname, '../inputs/false-positive-exclusions.txt'), 'utf8');
    const report = JSON.parse(fs.readFileSync(path.join(__dirname, '../build-report.json'), 'utf8'));
    assert.doesNotMatch(manifest, /^\[Rule\]$/m);
    assert.doesNotMatch(config, /^\s*- DOMAIN,(?:l-rcd|subscription)\.iqiyi\.com,DIRECT$/m);
    assert.match(exclusions, /^\+\.l-rcd\.iqiyi\.com$/m);
    assert.match(exclusions, /^\+\.subscription\.iqiyi\.com$/m);
    assert.deepEqual(report.false_positive_exclusions, [
        '+.l-rcd.iqiyi.com',
        '+.p2p.huya.com',
        '+.subscription.iqiyi.com',
    ]);
    assert.equal(report.merged_mrs_rules, 353220);
});

test('gateway card and comment requests use the same filters without changing ordinary cards or account data', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    const patterns = manifest.split('\n').filter(x => x.includes('type=http-response')).map(x => new RegExp(x.match(/pattern=(.*?), requires-body/)[1]));
    for (const host of ['access.if.iqiyi.com', '116.211.198.237', '111.63.147.158', '103.44.59.54']) {
        for (const endpoint of ['cards.iqiyi.com/views_home/3.0/qy_home', 'comment-card.iqiyi.com/views_comment/3.0/long_video_comments']) {
            const url = `https://${host}/3f1/${endpoint}?token=PRIVATE`;
            assert.ok(patterns.some(x => x.test(url)), url);
            const body = { cards: [{ alias_name: 'ad_trueview' }, { alias_name: 'focus', title: 'normal cover' }, { alias_name: 'film' }], vip: false };
            const output = run(url, body);
            assert.deepEqual(JSON.parse(output.result.body), { cards: body.cards.slice(1), vip: false });
            assert.doesNotMatch(output.logs.join(''), /PRIVATE|normal cover/);
        }
    }
});

test('gateway rewrite retains proxy path and encoded query and excludes unrelated IP traffic', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    const line = manifest.split('\n').find(x => x.includes('https://access.if.iqiyi.com/3f1/'));
    const [pattern, target] = line.split(' '), regex = new RegExp(pattern);
    const suffix = '/3f1/cards.iqiyi.com/views_home/3.0/qy_home?cursor=a%2Fb%3D';
    assert.equal(('https://116.211.198.237' + suffix).replace(regex, target), 'https://access.if.iqiyi.com' + suffix);
    for (const url of ['https://116.211.198.237/', 'https://116.211.198.237/image.jpg', 'https://116.211.198.237/3f1/passport.iqiyi.com/login', 'https://unknown.example' + suffix, 'https://116.211.198.237.evil.test' + suffix]) assert.equal(regex.test(url), false);
});

test('removes whole cards with observed strong markers while retaining ordinary block classes and comment containers', () => {
    const keep = {
        alias_name: 'focus',
        statistics: { is_cupid: 0 },
        blocks: [
            { block_class: 'base_block_slide_h9_class_short_video', image: 'cover.jpg' },
            { other: { native_ad: 0, mixer_ad: '0', is_ad_block: 0, empty_ad_block: 0 }, image: 'ordinary.jpg' }
        ]
    };
    const adverts = [
        { statistics: { is_cupid: 2 } },
        { strategy_com_id: 'ad_mobile_flow' },
        { strategy_com_id: 'common_banner_ad' },
        { strategy_com_id: 'immersive_focus_only_ad_newui' },
        { kv_pair: { convertor: 'cupidad_card' } },
        { name: '视频广告' },
        { blocks: [{ statistics: { is_cupid: '1' } }] },
        { blocks: [{ other: { native_ad: '1' } }] },
        { blocks: [{ other: { mixer_ad: 2 } }] },
        { blocks: [{ other: { is_ad_block: true } }] },
        { blocks: [{ other: { empty_ad_block: 1 } }] },
        { blocks: [{ other: { convertor: 'cupid_block' } }] }
    ];
    const body = { cards: [keep, ...adverts], base: { statistics: { ad_str: 'private', ad_str_map: { private: true }, normal: 1 } }, account: { vip: false } };
    assert.deepEqual(JSON.parse(run(cardURL, body).result.body), { cards: [keep], base: { statistics: { normal: 1 } }, account: body.account });

    const comments = { cards: [{ alias_name: 'comment_resource_card' }, { name: '视频广告', statistics: { is_cupid: 1 } }, { content: 'normal comment' }] };
    assert.deepEqual(JSON.parse(run('https://comment-card.iqiyi.com/views_comment/3.0/long_video_comments', comments).result.body), { cards: [comments.cards[0], comments.cards[2]] });
});

test('HTTP content entrances are explicitly sent to the HTTP engine, while DoH and image hosts are untouched', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    const line = manifest.split('\n').find(x => x.startsWith('force-http-engine-hosts ='));
    assert.ok(line);
    const hosts = line.split(' = ')[1].split(', ');
    for (const host of ['cards.iqiyi.com', 'access.if.iqiyi.com', '116.211.198.237', '111.63.147.158', '103.44.59.54', '59.39.2.11']) assert.ok(hosts.includes(host));
    assert.doesNotMatch(manifest, /116\.211\.189\.205|116\.211\.198\.144|103\.44\.58\.64|iqiyipic\.com|dns-hijack/);
});

test('observed direct cards HTTP address routes only known content paths and preserves the encoded query', () => {
    const manifest = fs.readFileSync(path.join(__dirname, '../module/iqiyi/iqiyi-adblock.sgmodule'), 'utf8');
    const line = manifest.split('\n').find(x => x.startsWith('^http://59') && x.endsWith(' header'));
    const [pattern, target] = line.split(' '), regex = new RegExp(pattern);
    const url = 'http://59.39.2.11/views_home/3.0/qy_home?cursor=a%2Fb%3D';
    assert.equal(url.replace(regex, target), 'https://cards.iqiyi.com/views_home/3.0/qy_home?cursor=a%2Fb%3D');
    const body = { cards: [{ alias_name: 'ad_trueview' }, { alias_name: 'film', image: 'cover.jpg' }] };
    assert.deepEqual(JSON.parse(run(url, body).result.body), { cards: [body.cards[1]] });
    for (const url of ['http://59.39.2.11/', 'http://59.39.2.11/image.jpg', 'http://59.39.2.11/passport/login', 'http://59.39.2.11.evil.test/views_home/3.0/qy_home']) assert.equal(regex.test(url), false);
});
