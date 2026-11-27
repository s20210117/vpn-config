# 知乎去广告模块

`zhihu-adblock.sgmodule` 声明 IP 和接口匹配规则，`zhihu-adblock.js` 处理响应；域名拦截由 `ads-merged.mrs` 提供。

当前版本 1.0.20：仓库模块使用 GitHub Raw 脚本地址，本地下载时自动生成当前 IP 的脚本地址；过滤范围不变。诊断模块的接收地址改为 `collector` 参数，本地下载自动填写。

## 1.0.19：域名规则迁入 MRS

`appcloud.zhihu.com` 与 `appcloud2.in.zhihu.com` 已迁入 `inputs/local-domains.txt`，随合并广告 MRS 构建，模块不再重复声明。先更新 `ads-merged.mrs`，再更新本模块。4 条 HTTPDNS IP 拦截及 URL、JS、MITM 处理继续保留。

范围仅为去广告，不包含会员解锁、会员状态伪装或付费内容解锁。

抓广告诊断模块：

```text
https://raw.githubusercontent.com/s20210117/vpn-config/main/module/zhihu/zhihu-capture.sgmodule
```

诊断模块只记录脱敏后的 JSON 结构，原响应保持不变。接收器命令：

```sh
python3 -B -u module/zhihu/capture_server.py
```

记录直接保存在 `module/zhihu/captures/`，不使用额外的 `runtime/` 目录。定位残留广告时，临时关闭「知乎去广告」、只启用「知乎抓广告诊断」，完全退出并重新打开知乎，然后依次刷新仍有广告的页面。抓取完成后关闭诊断模块并重新启用去广告模块。

## 使用

在手机 Clash-Client 的「模块」里添加以下 GitHub 地址并启用：

```text
https://raw.githubusercontent.com/s20210117/vpn-config/main/module/zhihu/zhihu-adblock.sgmodule
```

需要开启模块功能及 HTTPS 解密，并信任**模块的 HTTPS 解密证书**。你已经完成证书信任时，不必重新生成或重新安装。控制器 `9443` 的证书与模块解密证书是两件事。

远程导入和更新使用 GitHub 文件。需要调试本地文件时，启动模块下载服务，使用启动输出中的本地地址导入；服务会自动替换脚本和诊断接收地址：

```sh
python3 module/serve.py
```

配置中的 Sniffer（域名嗅探）必须开启，且允许识别纯 IP 连接。2026-11-23 的手机日志显示，`page-info.zhihu.com` 的详情脚本已执行，但与 `api.zhihu.com` 当前解析地址一致的 IP 连接直接放行；手机界面同时提示 Sniffer 已关闭。项目订阅已开启 TLS/QUIC 443 嗅探、`parse-pure-ip` 和 `force-dns-mapping`；全局 `override-destination` 保持关闭，仅对 QUIC 开启，使纯 IP QUIC 按嗅探出的实际域名进入模块。手机需同步完整配置后再验证，单独更新模块不能替换该配置开关。

随后完全退出、重新打开知乎，刷新推荐、热榜和回答列表，触发新的接口请求。已有缓存中的广告不一定立即消失。如果当前隧道尚未应用模块变更，需在客户端重新应用配置。

当前 `clash-cli` 没有模块导入或启用命令，因此不能把电脑上生成文件说成手机已经安装成功。模块导入不替换原来的完整配置、代理节点、策略组和 DNS。

## 2026-11-23 连接入口修正（1.0.1）

15:52 导出的日志确认 `Sniffer is loaded and working`，但 `43.242.197.211:443` 的 TCP 和 UDP 请求仍直接放行，未进入模块；只有 `page-info.zhihu.com` 的详情脚本执行。仅开启 Sniffer 没有解决问题。

模块 MITM 主机列表补充 `www.zhihu.com` 和当次 DNS 核对得到的知乎入口 `43.242.197.211`。客户端源码支持将无域名的 IP 主机条目转为精确 IP 路由，并为匹配入口阻断 UDP/443，使支持回退的请求使用 TCP 解密。没有把知乎主站或该 IP 整体设为 REJECT，也没有扩大响应脚本的接口范围。该 IP 是当前观察值，之后可能变化。

这次更新的是模块，完整订阅和脚本未改动。手机更新模块并重新应用后，需要验证 IP 连接是否进入 `MODULE-ENGINE`、回答列表脚本是否出现以及广告是否消失。现有日志不能证明新版模块已在手机生效。

## 处理范围

| 页面或接口 | 处理方式 |
| --- | --- |
| `commercial_api` | 返回空 JSON 对象，拦截开屏及回答底部广告接口 |
| `bazaar/float_window`、`root/window`、`api/v4/ecom_data/config`、问题横幅、优惠券提醒 | 返回空 JSON 对象，拦截浮动、横幅与优惠券接口 |
| 推荐、热榜、回答列表、回答信息流 | 同时过滤 `data`、`dataV1`、v2 热榜的 `data.data` 及已确认的后续回答嵌套列表中的明确广告类型、`is_advertiser` 与 `ad`、`adjson`、`ad_list`、`extra.promotion`、`promotion_extra`、`ad_info.data` 标记 |
| 问题回答列表 | 移除顶层 `ad_info` 广告字段 |
| 搜索建议与预置词 | 过滤带 `ad_commercial_json` 或 `preset_word_ad_commercial_json` 标记的条目 |
| 回答、文章详情接口 | 保留评论和相关查询等 `third_business` 正常数据；移除顶层广告字段，并从正文、会员正文及内容卡列表中删除明确的广告卡类型 |

响应脚本只处理列出的知乎主机和接口；除实抓为 POST 的搜索预置词外，其余均要求成功的 GET JSON 响应。脚本不按文章、视频、想法等正常内容类型删除，也不修改账号或会员字段。没有匹配、没有广告、非 JSON 或格式变化时保留原响应。

这不是 QX「知乎净化助手」全部功能的逐项复制；它保留明确广告过滤范围。新版本 App 接口、未标记的原生推广、视频流内部广告仍可能不在处理范围内。

## 更新与查看日志

1. 使用 GitHub 链接时保持远程地址可访问；本地调试时让手机与 Mac 保持同一局域网，并启动下载服务。
2. 手机 Clash-Client 进入「模块 → 知乎去广告」，点击「更新」。这会重新获取模块及其脚本，无需重新导入完整配置。
3. 进入「活动 → 日志」，确认已开启记录，日志级别选择「全部」。
4. 打开知乎刷新推荐或回答列表，再回到日志页搜索 `[知乎去广告]`。

脚本对匹配接口每次完成输出一条日志，例如：

```text
[知乎去广告] api.zhihu.com/topstory/recommend | 处理完成，列表 10→8，移除广告 2 条
[知乎去广告] api.zhihu.com/questions/:id/feeds | 处理完成，列表 5→5，移除广告 0 条，移除广告字段 ad_info
[知乎去广告] api.zhihu.com/topstory/recommend | 未发现可移除广告，保留原响应，列表 10→10，移除广告 0 条
[知乎去广告] api.zhihu.com/topstory/recommend | 跳过：HTTP 403
```

也会记录响应结构无法识别、非 JSON 响应及解析异常等情况。列表条目与广告字段分别统计，字段移除不等同于移除了一个广告条目。日志附带数组中的类型枚举和字段名摘要，用于识别新版结构；不记录查询参数、字段值、内容 ID、请求头或响应正文。

这些日志来自响应脚本；前面四条 URL 重写直接拦截的广告接口不执行该脚本，因此不会出现这类脚本日志。脚本日志进入客户端应用日志，当前 CLI 的 `logs` 读取内核日志。

## 依据与验证边界

用户提供的 QX 配置在 `[rewrite_remote]` 中启用了以下资源，且 `update-interval=-1`：

```text
https://gist.githubusercontent.com/ddgksf2013/d43179d848586d561dbb968dee93bae8/raw/Zhihu.Adblock.js
```

2026-11-23 检查时，该资源及对应 GitHub Gist API 均返回 HTTP 404。作者主页当时给出的 `https://ddgksf2013.top/scripts/zhihu.ads.js` 返回 HTML 网页，不能作为脚本使用。QX 已缓存的资源可能仍能工作；本项目没有读取手机上的 QX 缓存，无法确认其具体版本。

本实现参照已取得的 blackmatrix7「哲也同学」知乎规则和响应字段，仅保留去广告部分并独立实现：

- [知乎 QX 重写规则](https://github.com/blackmatrix7/ios_rule_script/blob/master/script/zheye/zheye.snippet)
- [对应响应脚本](https://gist.github.com/blackmatrix7/f5f780d0f56b319b6ad9848fd080bb18)
- [Clash-Client 模块解析器](https://github.com/ProjectClash/Clash-Client/blob/main/apple/ClashClient/Sources/ConfigStore/ModuleParser.swift)
- [Clash-Client 脚本声明解析](https://github.com/ProjectClash/Clash-Client/blob/main/apple/ClashClient/Sources/ConfigStore/ModuleLineSyntax.swift)

项目根目录运行：

```sh
node --test tests/test_zhihu_adblock.js
```

测试模拟客户端传入的请求、响应和 `$done`，检查广告移除、正常内容保留、异常响应放行、接口匹配边界以及只完成一次。它不代表手机已安装模块，也不代表当前知乎版本的实际去广告效果已验证。


## 浏览器查阅与接口补充（1.0.2）

2026-11-23 使用 Google 搜索并打开原始模块、脚本核对：

- [可莉插件中心](https://hub.kelee.one/)明确说明知乎插件处理 HTTPDNS/QUIC 下发配置。该站同时注明插件为 Loon 专用，不建议转换后直接使用。
- [QingRex 转换模块](https://github.com/QingRex/LoonKissSurge/blob/main/Surge/知乎去广告.sgmodule)列出了 `questions/{id}/answers`、`next-bff`、`next-data`、`search/recommend_query/v2`、`ad-style-service/request`、`distribute/rhea/qa_ad_card/h5/recommendation` 和主站 `commercial_api/banners_v3/mobile_banner`。这是第三方转换模块，不能视为 Clash-Client 已兼容或手机效果证明。
- [yisaings 原始推荐脚本](https://github.com/yisaings/surge/blob/main/zhihu/zhihu-feed-v6.js)会删除文章、视频等非问答内容；本项目不采用这些精简行为。

版本 1.0.2 只补充上述回答、后续回答、v2 搜索建议匹配和三个明确广告接口；回答接口支持移除对象形态的 `data.ad_info`，保留 `query_info`、普通内容和会员字段。`next-bff`、`next-data` 仍仅过滤已知 `data` 数组中的明确广告标记，不假定其所有响应结构与 `next-render` 相同。未知结构继续放行。

可莉原始 JS `https://kelee.one/Resource/JavaScript/Zhihu/Zhihu_remove_ads.js` 在浏览器和 HTTP 读取均返回 403，未取得具体 HTTPDNS/QUIC 字段实现，因此这次没有凭猜测修改下发配置。当前 23 项模拟测试通过不表示残留广告问题已经在手机解决；需要新版实际日志确认连接进入模块及新接口命中情况。


## IP 上游 TLS 名称修正（1.0.3）

16:13 导出的日志里，1.0.2 已拦截 `commercial_api` 广告接口，并从 v2 搜索建议移除一条广告；但有 155 条上游证书名称不匹配错误，目标为 `43.242.197.211`。这不是手机模块 CA 未信任：同一日志中的详情响应脚本仍正常执行。

电脑使用系统证书校验直接建立 TLS 验证：同一 IP 使用 `43.242.197.211` 作为校验名称失败，使用 `api.zhihu.com` 作为 SNI 和校验名称成功。客户端 `ModuleRequestURLs.make` 按 HTTP Host 匹配 URL，但 `ModuleExchange` 默认沿用连接目标作为上游 TLS 名称；因此命中域名重写不代表未改写的上游连接也使用正确名称。

新增最后一条透明 URL 重写 `^https://api\.zhihu\.com/(.*)$ https://api.zhihu.com/$1 header`。源码中透明重写会通过 `Route.to` 重建目标与 TLS 名称，Host 跟随目标域名。广告直接拦截仍排在前面。规则仅匹配明确的 API 域名，不将共享 IP 上所有未知请求强制改为知乎，也不关闭证书校验。仅修改模块文件，不更改脚本、完整订阅、节点或 DNS。

24 项测试验证原有过滤和重写匹配、路径参数保留及域名边界；未运行手机端新版引擎，仍需实际日志确认错误减少及回答脚本命中。当前无法把共享 IP 上每一条失败连接都归因于知乎 API，剩余未知请求不作强制重定向。


## 多页面残留诊断（1.0.4）

16:22 日志中的 API 内部转发已命中，仍有 24 次共享 IP 上游证书失败；不能将不同时间窗口的 155 次和 24 次直接当作错误率改善。回答列表脚本仍没有执行记录，首页推荐仍报告 6 条均保留，用户确认回答列表、正文底部、首页都有残留。

- 对明确的 `www.zhihu.com`、`web-render.zhihu.com`、`page-info.zhihu.com` URL 同样使用透明内部转发修正上游域名，保留原路径与参数。
- 依据已核对的 yisaings 推荐脚本，只增加 `extra.content_type` 为 `ad`、`promotion` 的明确广告判断，不使用其删除非问答内容的规则。
- 增加 `zhihu-route-probe` 请求诊断脚本，对共享 IP 和主站入口仅记录接口类别。数字、未知路径段统一显示为 `:segment`，不记录查询参数、账号、正文或请求头。`debug=false` 关闭诊断。请求诊断始终返回空修改，不更改请求。

更新链接保持不变。此版本是定向补充和定位工具，并非所有残留广告已经解决。26 项模拟测试通过；需要手机更新模块后重新触发这三个页面，才能从新增的 `[入口诊断 1.0.4]` 记录判断未知接口。模块没有关闭证书校验，没有把共享 IP 的未知请求一律改发到 API。


## 无域名根请求 TLS 转发（1.0.5）

16:34 导出的日志包含 80 条 `43.242.197.211/` 根路径诊断以及 80 条按该 IP 校验证书失败；已命名的 API 和详情 URL 走域名转发。为日志中这一根路径补充透明转发至 `https://api.zhihu.com/`，包括可选查询字符串，借助客户端 `Route.to` 设置域名上游及 SNI。此 IP 当次解析对应 API，电脑直接 TLS 验证使用 `api.zhihu.com` 通过，使用 IP 校验失败。

该映射仅针对观察到的 IP 根路径，不声称已识别请求的业务用途；不映射 IP 的其他路径或共享 IP 上的其他域名，不关闭证书校验。后续 IP 归属变化时需要重新核实。27 项测试通过，测试包含根路径和参数保留及未知路径排除；手机端错误是否消除仍需更新后的日志验证。这项修正不代表所有残留广告已移除。

## 共享 IP 上其他已命名请求（1.0.6）

16:45 日志中 IP 根路径转发命中 13 次，但仍有 73 条上游证书名称错误。进入 IP 解密连接的请求还包含 duga、m-cloud、appcloud.zhihu.com 以及 pic2、pic3、pic4、pica.zhimg.com。为这些实际出现的域名补充同址透明转发，保留域名、路径、查询参数，令上游使用原请求域名作为 TLS 名称；不增加 MITM 域名范围，不关闭证书校验。是否消除手机端剩余错误仍需更新后的日志验证。

## 评论区广告（1.0.7）

参照 blackmatrix7 哲也同学 removeComment 的广告处理，为 comment_v5 下回答、文章、想法及评论的 root_comment / child_comment 增加响应处理，仅将根节点 ad_info 清空为对象，保留评论列表、分页、权限及账号信息。已为空对象时保留响应原文。此接口未在 16:51 日志中出现，新增覆盖是否命中及残留广告改善程度需手机验证。16:51 日志无上游证书错误，保留 1.0.6 的转发修复。

## 问题详情与网页推荐接口（1.0.8）

截图定位为问题回答列表和回答正文下方的明确广告卡片，并非评论区。17:00 日志中出现 www.zhihu.com/api/v4/questions/{id}，此前未执行响应清理。新增原生 questions/{id} 及网页 api/v4/questions/{id}（可选 feeds/answers）响应处理，沿用根节点及对象 data.ad_info 清理，保留 query_info。参考哲也同学的问题详情路由；网页 recommendations? 接口覆盖依据 QingRex/LoonKissSurge 的原始模块清单，仅复用现有明确广告标记过滤 data 数组，未知响应不变。未修改 appview HTML；直接请求该页面返回 403，未获取实际广告响应，不能确认截图广告来自哪一个接口。手机端效果待验证。

## 实抓结构完善（1.0.10）

2026-11-25 的知乎诊断模块保存了 118 条脱敏记录。实抓确认推荐接口同时返回 `data` 与 `dataV1`，两处均包含 `type=feed_advert`；搜索预置词 POST 响应出现 `ad_commercial_json` 与 `preset_word_ad_commercial_json`；一份文章详情在普通 `link-card` 旁出现精确的 `ad-link-card`。本版只补这三种已确认结构，保留普通卡片、正文、会员入口和含义不明确的推广字段。

同一日志还显示 `43.242.197.211` 当前返回 `*.unionpayintl.com` 证书，已不能继续作为知乎固定入口。去广告与诊断模块均移除该 IP 的 MITM、重写和脚本范围，避免证书错误及无关流量误接管。历史章节保留的是当时的排查过程，不代表当前仍使用该 IP。

## 截图残留修复（1.0.11）

14:25 日志确认推荐响应已移除两条明确广告；截图中的残留位于回答列表与回答正文。详情清理现已同时覆盖回答和文章中的精确 `ad-link-card`，推荐过滤补充诊断记录中出现的 `ad_list` 与 `extra.promotion`。普通链接卡、付费提示卡和奖励卡继续保留。

## 回答列表执行修复（1.0.12）

14:29 的第二次诊断共保存 19 条回答、文章详情结构，未出现截图中的广告字段，但确认 `third_business` 只包含评论和相关查询等正常数据，因此不再整体删除。用户提供的 QX 执行记录确认残留广告页面请求为 `api.zhihu.com/questions/{id}/feeds`；公开 QX/Surge 模块对此响应不限制正文大小，而本模块此前设置为 2 MiB，14:25 日志中也没有该处理器的执行记录。本版将回答列表与后续回答响应上限提高到 8 MiB，并补充公开实抓方案中的 `is_advertiser`、`next-bff.origin_data` 和 `next-data.data.data` 明确广告结构。

`page-modular.zhihu.com` 在 14:08 日志中出现过，但公开仓库最终版本没有保留对其响应的删除逻辑，也没有可核验的广告结构。诊断模块 1.0.2 将其纳入脱敏抓取；正式去广告模块不整域拦截，避免误伤正常页面组件。

## 回答列表正文上限修正（1.0.13）

14:59 日志确认 1.0.12 已加载，但广告出现期间没有 `questions/{id}/feeds` 或 `topstory/recommend` 响应进入脚本，也没有正文超过 8 MiB 的跳过记录；当次只执行了搜索预置词和回答、文章详情处理。说明当时页面主要复用了知乎已缓存的回答列表，模块无法倒过来修改 App 已经保存的旧响应。

同时修正 1.0.12 与公开方案仍存在的一处差异：客户端源码中省略或写 `max-size=0` 会回到 iOS 的 1 MiB 默认值，负数才表示响应正文不设模块声明上限。因此原生及 Web 问题回答列表改为 `max-size=-1`，避免后续重新请求较大的回答列表时再次因正文大小跳过。其他接口仍保留原上限。入口诊断不再输出高频的 `sc-profiler-zhapp` 遥测请求。

15:06 的 QX HAR 进一步确认回答列表原响应含有一个由 `ad`、`adjson`、`position` 组成的广告对象。QX 将它从 `data` 移出后，剩余 10 条均为普通 `question_feed_card`；本模块现有的明确广告判定会直接从 `data` 删除同一形态，不保留广告素材和跟踪字段。HAR 中 `appcloud2.zhihu.com` 只出现正常的资源版本、`group_name=hybrid` 和资源请求，因此没有按域名或资源接口整体拦截。

## 残留卡片结构诊断（1.0.14）

15:45 日志确认首页过滤正常执行：热榜 31→30、推荐流 14→12；回答列表仍未产生 `questions/{id}/feeds` 或 `next-*` 网络请求。正文详情的六次 `page-info` 响应均进入脚本，但现有规则没有识别出广告卡。

详情卡片判断从单一的 `ad-link-card` 扩展为边界明确的 `ad`、`advert`、`commercial`、`sponsor`、`promotion` 类型族，仍保留普通链接、付费提示、奖励等卡片。QX HAR 中另有 `/v2/topstory/hot-lists/everyone-seeing`，其列表位于 `data.data`；该样本没有广告，本版仍按与普通热榜相同的明确标记安全覆盖该入口。正式脚本日志同时输出脱敏的类型与字段名摘要，后续可直接从客户端日志识别未知卡片结构，不记录字段值、正文、账号或内容 ID。

## HTTPDNS 绕行修复（1.0.15）

16:01 日志确认回答列表广告所在的 `questions/{id}/feeds` 没有进入模块，同时 `182.61.194.7:80` 及其下发的纯 IP 连接直接放行。QX HAR 确认 `182.61.194.7/v2/resolv` 是知乎 HTTPDNS；QX 返回空响应，公开知乎模块也在规则层拦截该服务。

本版按公开方案拦截知乎 HTTPDNS 配置域名及其固定解析服务地址，使 API 请求回退到系统 DNS 后进入现有域名 MITM。没有写入日志里临时下发的 API 地址，也没有扩大广告内容删除条件。

## 问题页推广接口（1.0.16）

16:20 日志确认 HTTPDNS 拦截已经生效，回答列表连续进入脚本且只剩普通回答。新增精确拦截日志中仍在请求的问题页 `banner` 和详情页优惠券提醒接口；不拦截 `page-modular`，不删除正常 `ComponentCard`、`sdui` 或作者正文商品卡。

## 回答信息流 QUIC 回退（1.0.17）

16:45 日志中，官方推广卡和普通视频广告出现期间没有 `questions/{id}/feeds` 响应脚本记录，但 `43.242.197.211:443` 的 UDP 连接每约 30 秒直接放行。该连接绕过了现有 HTTPS 响应处理。

Mihomo 官方文档说明，协议级 `override-destination` 会覆盖全局设置并使用嗅探结果作为实际目标。完整配置仅为 QUIC/443 开启该选项，使纯 IP 请求按嗅探出的知乎域名进入模块；不固定拦截共享 CDN IP，避免误伤同 IP 的其他服务。QX 实抓中的官方推广和普通广告均带 `ad`、`adjson` 等明确标记，现有脚本已经覆盖，不新增按账号名或广告文案误删内容的条件。

## 保留知友反馈（1.0.18）

用户确认问题页的“小蓝星/来自知友的真实反馈”属于正常内容。移除对 `www.zhihu.com/api/v4/topics/rank_list/question/{id}/related` 的拦截，保留该内容；其他广告接口和响应过滤不变。
