# 虎牙去广告 1.0.7

正式模块：http://192.168.2.77:18765/huya/huya-adblock.sgmodule

抓广告诊断：http://192.168.2.77:18765/huya/huya-capture.sgmodule

范围仅为去广告，不包含会员、清晰度或付费功能解锁。

## 正式模块

当前版本处理公开方案能够交叉核验的广告入口：

- `business.msstatic.com/advertiser/`：返回空广告数据。
- `business.msstatic.com/dsp/public/sdkconfig.xml`：拦截广告 SDK 配置。
- `cdnfile1.msstatic.com/cdnfile/appad/`：拦截开屏广告图片。
- `live-ads.huya.com/live/getAllEntrance`：返回空直播间广告入口数据。
- 公开方案的备用开屏主机：拦截 `livewebbs2pcdn.msstatic.com`、`pp-cdnfile2pcdn.msstatic.com`、`huyafile.msstatic.com`、`v1d.szbdyd.com` 和 `3dm.huya.com`。
- `zt.huya.com`：只拦截诊断抓到的两个官方推广小窗活动路径。
- 穿山甲广告 SDK：拦截广告 API 主机 `api-access.pangolin-sdk-toutiao.com` 和广告渲染资源主机 `sf3-fe-tos.pglstatp-toutiao.com`。
- 腾讯广点通广告 SDK：拦截实际广告获取主机 `us.l.qq.com`、配置主机 `tangram.e.qq.com` 和广告素材主机 `pgdt.gtimg.cn`。

虎牙自身接口按精确路径使用 URL Rewrite；第三方专用广告主机使用域名规则，不加入 HTTPS 解密清单。模块没有封锁整个 `huya.com` 或 `msstatic.com`，也没有递归删除所有名称含 `ad` 的字段，避免影响直播、登录、关注、观看历史和清晰度选择。

用户提供的 QX 配置没有虎牙规则，本模块不以 QX 为来源。规则依据为 [fmz200/wool_scripts 的 HuyaLive.sgmodule](https://github.com/fmz200/wool_scripts/blob/main/Surge/module/split/partH/HuyaLive.sgmodule) 与 [blackmatrix7/ios_rule_script 的 AdvertisingLite](https://github.com/blackmatrix7/ios_rule_script/blob/master/rewrite/Surge/AdvertisingLite/AdvertisingLite.sgmodule)；本版只采用两者可核验的精确路径，没有照搬公开模块中的整域名拦截。

## 1.0.1：补齐明文 HTTP 与实测开屏主机

11:10 日志确认模块已正常加载，但 `cdn.wup.huya.com:80` 有 13 次直接放行；HTTPS 又被虎牙拒绝模块证书，客户端随后将该主机透明转发。本版强制四个已知入口的明文请求进入 HTTP 引擎，并从 HTTPS 解密清单移除 `cdn.wup.huya.com`，让 HTTPDNS 拦截不再产生反复的证书错误。

广告出现期间，公开 HuyaLive 规则列出的 `livewebbs2.msstatic.com` 有 6 次直接连接，因此补充该单域名拒绝。`business.msstatic.com` 已进入模块但没有命中原先过窄的 `/advertiser/material`，现按 blackmatrix7 的公开规则扩大到 `/advertiser/` 目录；没有拒绝整个 `business.msstatic.com`。其他未在日志出现的公开整域规则仍不加入。

## 1.0.2：补充广告 SDK 配置

11:14 的 QX HAR 在播放失败前捕获到 `business.msstatic.com/dsp/public/sdkconfig.xml`，这是明确的广告 SDK 配置入口，现按精确路径拒绝。HAR 中的头像、直播封面、截图和回放图片保持放行；没有据此封锁普通图片域名或编写通用删字段脚本。

QX 开启广泛抓包后虎牙播放失败，说明整域 HTTPS 解密会影响虎牙的证书固定或二进制 WUP 播放链路。因此抓广告诊断 1.0.1 也已收窄为已知广告入口，不再解密整个 `*.huya.com` 或 `*.msstatic.com`。

## 1.0.3：撤回 HTTPDNS 拦截

11:30 日志确认 `/launch/queryHttpDns` 被拒绝后，虎牙会立即高频重试；客户端随后把拒绝升级为丢弃，并出现大量连接内存配额告警。QX HAR 同时确认该接口承载正常直播、点播和 CDN 地址，并非广告专用接口。正式模块和抓广告诊断现均不再拦截或接管 `cdn.wup.huya.com`，其余已确认的广告接口和素材规则保持不变。

## 1.0.4：处理官方推广小窗

诊断捕获到 `zt.huya.com/8cc59b08/mobile/index.html` 与 `zt.huya.com/a215cf20/mobile/index.html`，公开页面标题分别为“感恩头条-横屏小窗”和“充值狂欢日-活动小窗”。本版只拒绝这两个已确认路径，不封锁整个 `zt.huya.com`。同时从合并广告规则中排除 `+.p2p.huya.com`，修复日志确认的虎牙播放 P2P 误拦截。

## 1.0.5：补齐第三方广告 SDK

11 月 26 日的 ProxyPin HAR 抓到穿山甲和腾讯广点通两套广告 SDK。`us.l.qq.com/exapp` 返回完整开屏广告数据，随后由 `pgdt.gtimg.cn` 下载 1080 x 1920 广告图；`tangram.e.qq.com/updateSetting` 的配置包含虎牙动态开屏广告开关。`sf3-fe-tos.pglstatp-toutiao.com` 返回广告渲染器和互动素材，`api-access.pangolin-sdk-toutiao.com` 提供穿山甲广告 API。本版拒绝这五个专用广告主机，不加入 HTTPS 解密清单。

`sdkreport.e.qq.com/link_event`、`p.l.qq.com/p` 和 `api-access.pangolin-sdk-toutiao1.com/.../stats/batch` 仅用于广告上报或点击后的交互，不负责下发或渲染广告，因此不拦截，避免无效重试。

同一份 HAR 中，`cdn.wup.huya.com/launch/queryHttpDns` 返回正常直播、点播、P2P、WebSocket 和 CDN 地址；`wup.huya.com`、`wsapi.huya.com` 也属于虎牙核心通信，继续保持放行。

## 1.0.6：补齐备用开屏素材主机

14:40 日志确认新版合并规则已下载，虎牙 P2P 全部恢复直连；正式模块也已拒绝广点通、穿山甲、`livewebbs2.msstatic.com` 和已知活动页，但手机仍显示开屏广告。由于该次启动没有放行新的广告获取或素材请求，画面可能来自虎牙此前保存的本地素材。

本版补入 [fmz200/wool_scripts 的 HuyaLive.sgmodule](https://github.com/fmz200/wool_scripts/blob/main/Surge/module/split/partH/HuyaLive.sgmodule) 标记为开屏广告的五个备用主机。仍不采用其 `cdn.wup.huya.com/launch/queryHttpDns` 规则，因为实测该接口承载正常播放地址且拦截后会高频重试。网络模块无法删除 App 已经保存到本地沙盒的广告素材；更新后若旧画面仍出现，需要在虎牙内清理缓存后再完全退出并重开一次。

## 1.0.7：修正正常资源误拦并补充官方推广页

15:19 诊断确认新开屏仍由已经覆盖的广点通链路下发：`us.l.qq.com/exapp` 返回包含 `splash_switch` 的广告数据，随后从 `pgdt.gtimg.cn` 下载素材。诊断模块为了抓取证据临时放行了这些主机，因此测试时广告换新；正式模块继续拒绝该链路，不需要扩大开屏规则。

同次抓取发现 `livewebbs2.msstatic.com` 同时承载头像、匹配页背景、青少年支付提示、功能图标和预约素材，整域拒绝会破坏正常界面，因此从正式模块移除。七份合并广告源没有这条规则，无需增加全局排除。新增的 `zt.huya.com/8bec7583/mobile/index.html` 页面标题为“异人之下-定档活动”，本版只精确拒绝该推广页，不拒绝相邻路径或整个活动域名。

## 使用

在手机 Clash-Client 的「模块」中添加正式模块地址并启用。需要开启 HTTPS 解密并信任对应证书。更新后完全退出虎牙再重新打开，检查开屏、首页和直播间广告。

## 抓广告诊断

残留广告需要真实响应结构才能安全处理。诊断时先关闭「虎牙去广告」，只启用「虎牙抓广告诊断」，然后在 Mac 项目目录运行：

```sh
python3 -B -u module/huya/capture_server.py
```

依次重新启动虎牙、打开首页、推荐列表和直播间并触发残留广告。记录直接保存在 `module/huya/captures/`，不增加 `runtime/` 目录。诊断模块临时放行并检查已知广告配置、素材主机及 14:56 日志中的五个候选 CDN，避免全局广告规则在脚本前拒绝请求；所有响应仍原样返回。JSON 只上传脱敏后的接口路径、字段结构和广告标记；素材及其他格式只上传路径、状态、类型和长度。它不保存查询参数、请求头、正文、账号或设备标识，也不接管 WUP、WebSocket、P2P、直播、头像或直播封面主机。完成后关闭诊断模块，再启用正式去广告模块。
