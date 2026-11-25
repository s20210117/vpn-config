# 爱奇艺去广告 1.0.12

导入：http://192.168.2.77:18765/iqiyi/iqiyi-adblock.sgmodule

脚本：http://192.168.2.77:18765/iqiyi/iqiyi-adblock.js

抓广告诊断：http://192.168.2.77:18765/iqiyi/iqiyi-capture.sgmodule

本地抓取记录保存在 `captures/`。

在客户端模块中导入并启用，HTTPS 解密和证书信任使用现有设置。日志搜索 `[爱奇艺去广告]`；参数 `debug=false` 可关闭脚本日志。

## 来源与范围

用户 QX 配置没有单独的爱奇艺重写项；其中旧 StartUpAds.conf 引用返回 404，未取得其缓存内容，不能声称复制了 QX 的爱奇艺方案。

接口及广告字段依据：[QingRex/LoonKissSurge 爱奇艺模块](https://github.com/QingRex/LoonKissSurge/blob/main/Surge/Beta/爱奇艺去广告.beta.sgmodule)，原始模块署名可莉。本脚本为独立精简实现。

- cards.iqiyi.com、comment-card.iqiyi.com：按实抓的 Cupid、广告策略、广告转换器及广告块标记删除整张广告卡；清理 base.statistics.ad_str 与 ad_str_map。
- iface2.iqiyi.com：处理 common_switch、短视频流广告、暂停广告控制项及 init_login 的 ad_info。
- api.iqiyi.com：从 bundle/common 中移除实抓的 Cupid 广告 Service Worker 配置包。
- kjp/t7z.cupid.iqiyi.com：移除 mixer 响应的 adSlots。

保留普通焦点图、未知卡片、正常推荐、栏目、评论容器、封面及账号会员字段。未采用上游对整个 API 域名或固定 IP 的封锁，也未删除正常界面功能。

仅对上述明确主机启用 MITM。命中域名透明转发沿用知乎模块验证过的方式修正上游 TLS 名称；不关闭证书校验。未知结构、非 JSON 和失败响应保留原文。

已通过本地行为测试，尚未进行手机爱奇艺实测。视频前贴片可能使用不同主机、协议或广告数据格式，移除 adSlots 的效果和播放兼容性需要验证，不能保证覆盖所有广告。

## 1.0.1：首轮实测修正

14:54 日志没有爱奇艺响应清理记录，t7z 上游提前关闭连接共 77 次，不是证书名称错误。实际出现 mixer GET/POST，以及 dsp_track3、track2、ssp_track。对这两个广告主机的 mixer 与上述精确广告跟踪路径改为本地 reject-dict，排在透明转发之前，不再等待这些上游响应。

首页 cards-css.iqiyi.com 被现有规则集 REJECT（54 条连接记录），未取得接口路径或响应；补充该主机的 MITM 和与 cards 相同的已知路径处理，属于待实测验证的兼容覆盖，不能确认返回结构一致。评论区补充上游已列出的 comment-card 接口，仅过滤明确广告 alias，不删除缺少 alias 的普通评论。

bundle/common 和 mix_touch_rec 出现在日志中，但未取得响应结构，本版未猜测字段修改。截图中的大焦点广告也可能仍残留；没有采用删除整个 focus 栏目的方式。更新后需检查新日志中的入口和处理记录，确认去广告效果及正常播放。

## 1.0.2：按实际请求修正

15:00 日志确认 mixer 15 次、dsp_track 22 次、track 12 次命中本地拦截；没有响应清理日志。剩余 18 条提前关闭均发生在 cards-css，模块上游 127.0.0.1 的连接仍被原规则集 REJECT；它实际请求的是 css_layout/3.0/package_theme 和 query_iap_list，并非首页内容。撤销 1.0.1 对 cards-css 的 MITM、转发和脚本覆盖，恢复该主机原有处理，不放行已有拦截。

针对实际出现的 iface2 aggregate/3.0/mix_touch_rec，新增响应脚本；fusion/3.0/bundle/common 也纳入配置脚本。允许 GET/POST。混合推荐中仅过滤嵌套数组内已有的四个明确广告 alias，递归深度最多 24，保留普通视频与评论；bundle/common 仅沿用既有 content.switchs 等字段处理，不假设未知配置结构。未知响应保留原文，日志只记录固定字段白名单的类型、数组长度，无正文、账号或查询参数。尚无这两个接口的真实响应，不能宣称截图中的广告已被清除，需手机日志验证。

## 1.0.3：HTTPDNS 内容入口与广告块

封面空白已由用户确认与路由器网络有关，手机流量正常；本次继续广告修复，不调整 DNS、订阅、封面图片域名或路由器。

交叉核对原始资料：
- fmz200/wool_scripts 的 [QX 爱奇艺片段](https://github.com/fmz200/wool_scripts/blob/main/QuantumultX/rewrite/split/partA/iQIYI.snippet)、[Surge 爱奇艺模块](https://github.com/fmz200/wool_scripts/blob/main/Surge/module/split/partA/iQIYI.sgmodule) 及 [cnftp.js](https://github.com/fmz200/wool_scripts/blob/main/Scripts/cnftp.js)。QX 与 Surge 是同一来源的两个格式，不视为独立作者。
- QingRex/LoonKissSurge 爱奇艺模块（原作者可莉），此前已读取；其外部 JavaScript 返回 403，未声称取得该脚本。ddgksf2013/Rewrite、app2smile/rules 当前树未找到独立爱奇艺文件，blackmatrix7 搜到的主要为分流清单，不当作去广告脚本。

fmz200 清单确认内容接口还使用 access.if.iqiyi.com 或 IP 的 /3f1/cards.iqiyi.com/... 入口。15:10 日志中 116.211.189.205、116.211.198.144、103.44.58.64 被原规则集拒绝；这三个 IP 通过 access.if.iqiyi.com 的系统 TLS 名称校验，未携带参数的入口请求返回 403。此验证不证明每条被拒绝连接都为内容请求；需更新后诊断验证。

将上述三个观察 IP 与 access.if 域名纳入 MITM，仅对 /3f1/cards.iqiyi.com/ 和 /3f1/comment-card.iqiyi.com/ 路径透明转发至 access.if 的同一路径，保留参数和编码，并使用已验证域名校验上游。没有整体放行这些 IP，也没有改写其他路径至内容接口。响应脚本将该入口归一化后处理。

新增 categorylib_content、film_hybrid、search 接口覆盖；根据 cnftp.js 与 QingRex 的共同广告标记，在内容接口 cards/blocks 数组中移除非空字符串 block_class 项，补充 comment_resource_card、comment_resource_convention_card 广告资源位。正常 focus、未知卡片、空 block_class、图片字段与普通评论保留。未采用来源中删除整个 focus、无 alias 评论或所有播放推荐栏目的做法。

13 项测试通过。仅验证合成响应、路由边界和保留行为，尚未确认手机端命中及实际广告效果。

## 1.0.4：HTTP 80 入口未进入脚本

通过用户此前授权的 CLI 控制器只读查询 `/rules`，确认手机已加载 1.0.3 的数值 IP MITM 规则，且位于主配置广告规则前；该规则命中为 0。因此不能把问题解释为“单纯优先级低”。没有修改手机控制器设置。

手机 `/dns/query` 与电脑 DNS 交叉核对：116.211.189.205、116.211.198.144 对应 doh.iqiyi.com。先前仅用 access.if 的证书校验通过就认定其为内容入口不充分；本版撤销 1.0.3 三个推测 IP 的 MITM/脚本覆盖，保留既有 DoH 拦截。

15:24 日志另外存在 HTTP 80 连接：116.211.198.237（2）、111.63.147.158（2）、103.44.59.54（1）走直连，59.39.2.11（1）被拒绝。后一个地址由手机 DNS 确认为 cards.iqiyi.com 的当前 A 记录。前三个是日志观察地址，响应用途仍需命中验证，不能视为已确认返回内容。

依据客户端 ModuleParser 对 `[General] force-http-engine-hosts` 的支持，以及 ModuleEngineRoute 对 HTTP 强制入口的规则生成方式，补充明确域名和上述四个 IP 的 HTTP 引擎入口（默认 80 端口）。原先仅有 MITM 443 不足以覆盖明文 HTTP。对 /3f1/cards 或 comment-card 路径使用既有广告脚本；对 59.39.2.11 仅在已知内容接口路径重建为 cards 域名，保留查询编码。没有整体放行 IP、修改订阅 DNS、图片域名或路由器。

15 项本地测试通过，在线模块与脚本一致。验证覆盖 HTTP 配置声明、路由边界、查询编码保留及合成响应处理，不替代更新后手机端的入口命中和广告效果验证。

## 1.0.5：按 96 条手机实抓响应完善

诊断抓包确认了首页、分类、瀑布流、评论区、短视频流、暂停广告、登录初始化和配置网关中的真实广告结构。本版不再用非空 block_class 判定广告，因为正常封面块同样存在该字段；改为只使用 is_cupid、明确广告策略、Cupid 转换器及 blocks 中的广告标记，命中后删除整张广告卡。

video_feed 仅删除 adPs 或 adOccupied 大于 0 的 feed；pop_control 仅删除 pause_ad 和两个 sales_promotion 控制项；init_login 仅删除 content.ad_info；bundle/common 仅删除 ID 同时包含 cupid 与 ad-sw.js 的配置包。会员状态、before_patch_free_ad、值为 0 的广告交换字段、普通促销和封面数据保持不变。

实抓还证明 comment_resource_card 是评论容器、mix_touch_rec 本轮是正常短剧内容，因此不再把评论容器当广告，也不再拦截 mix_touch_rec。20 项定向测试覆盖这些保留边界和新增接口。

## 1.0.6：恢复上拉加载与观看历史同步

11:10 日志确认 `cards.iqiyi.com/waterfall/3.0/feed` 的部分分页仅返回广告卡；1.0.5 删除整张广告卡后会留下空页，客户端因此停止继续上拉。1.0.6 不再处理瀑布流接口，优先保证分页连续，允许该位置保留广告。

同一日志确认观看历史同步主机 `l-rcd.iqiyi.com` 被主广告规则集误判并拒绝。订阅配置已在两个广告规则集之前增加该主机的 `DIRECT` 规则。`iface2.iqiyi.com/aggregate/3.0/play_record` 不进入去广告响应脚本，历史内容保持原样。

## 1.0.7：去除瀑布流广告并让历史放行随模块生效

11:29 日志确认 1.0.6 完全放行 `cards.iqiyi.com/waterfall/3.0/feed` 后，上拉恢复但广告响应也随之恢复。1.0.7 重新处理该接口及实抓到的 `waterfall-plt/3.0/feed`：混合分页删除广告卡；广告独占分页保留一张已清空 `blocks` 和广告标记的不可见卡片占位，同时保留 `base.has_next`、`base.next_url` 等翻页元数据，避免再次因空 `cards` 停止加载。

同一日志中 `l-rcd.iqiyi.com` 仍被主广告规则集拒绝 6 次，手机实际运行规则没有加载订阅中的放行项。本版在模块自身增加 `[Rule] DOMAIN,l-rcd.iqiyi.com,DIRECT`，使观看历史同步放行与爱奇艺模块一起加载；历史列表接口继续保持原响应。

## 1.0.8：保留无内容布局块以继续翻页

11:45 日志确认 1.0.7 已清除瀑布流广告，观看历史也已恢复，但纯广告分页被处理成 `blocks=[]` 后没有列表高度，客户端只预取到 `pg3` 就停止继续翻页。1.0.8 改为保留一个仅含布局标识的空 block；图片、视频、文字、按钮、动作、统计和广告扩展字段均不保留，以维持翻页触发条件而不恢复广告内容。

## 1.0.9：改用公开模块的 block_class 处理

按用户要求移除 1.0.8 的自定义布局占位，瀑布流改为与 QingRex/可莉公开模块 `del(.. | select(.block_class?))` 等价的递归删除：删除所有带 `block_class` 的对象，保留其他响应与分页字段。该公开方案没有补偿纯广告页被删成空 blocks 的情况，因此仍可能出现连续翻页停止。

## 1.0.10：恢复预约与追剧

12:16 日志确认点击预约或追剧时，功能主机 `subscription.iqiyi.com` 被主广告规则集连续拒绝。模块和订阅配置均在广告规则之前增加该主机的 `DIRECT` 规则；观看历史的 `l-rcd.iqiyi.com` 放行保持不变。响应脚本与公开 `block_class` 瀑布流处理没有改动。

## 1.0.11：在广告规则中修复业务域名误报

确认 `l-rcd.iqiyi.com` 与 `subscription.iqiyi.com` 是合并广告 MRS 中的显式后缀误报，不是整个 `iqiyi.com` 通配命中。已从广告规则构建产物中排除这两个后缀并重新生成 MRS；模块和主配置不再添加对应的 `DIRECT` 规则，其他爱奇艺广告域名保持原有拦截。响应脚本与公开 `block_class` 瀑布流处理没有改动。

## 1.0.12：按模块整理目录

模块与脚本位于 `module/iqiyi/`，脚本下载地址为 `/iqiyi/iqiyi-adblock.js`。抓广告诊断文件一并归入爱奇艺目录；过滤行为未改动，旧的平铺链接不再保留。
