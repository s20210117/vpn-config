# DNS 跟随上网模式

完整配置位于 `subscription/config.yaml`，公开模板是项目顶层的 `dns-follow-mode.yaml`。本次修正了完整配置中网站、节点、引导 DNS 都使用 `system` 的状态；修改前快照保存在 `subscription/before-dns-follow-mode.yaml`。

## 使用方式

Clash-Client 首页的出站模式保持「规则」，通过「上网模式」策略组选择上网方式（原名 `Ad`）。该组排在策略组首位，成员顺序为 `PASS`、`DIRECT`、`PROXY`；未保存选择时默认使用 `PASS`，客户端已经保存的选择可能继续保留：

| 上网模式 选择 | DNS 行为 |
| --- | --- |
| `PROXY` | 默认网站 DNS 使用 Cloudflare / Google DoH，DNS 连接按网络规则经 `上网模式 → PROXY` 发送 |
| `DIRECT` | 境外列表中的域名使用 Cloudflare / Google DoH，其他直连域名使用阿里 DoH；DNS 连接直连，不要求手机代理节点可用 |
| `PASS` | 继续执行原有分流；DNS 连接按分流规则发送，直连出口也遵循域名 DNS 策略 |

`respect-rules: true` 控制 DNS 服务器连接的出口，不代表自动按每个网站分类选择 DNS 服务器。`nameserver-policy` 将 `geosite:geolocation-!cn` 中的域名交给 Cloudflare / Google DoH；`direct-nameserver-follow-policy: true` 使直连解析也遵循该策略，其余直连域名使用 `direct-nameserver` 中的阿里 DoH。

手机的 `DIRECT` 表示不使用手机代理节点，流量仍经过家庭路由器；路由器可以继续代理这些流量。在移动网络下，`DIRECT` 本身不会提供代理能力，访问受限网站仍需 `PASS` 或 `PROXY`。

## 解析服务器

- 默认网站 DNS：`https://1.1.1.1/dns-query`、`https://8.8.8.8/dns-query`。
- 节点域名 DNS：`https://223.5.5.5/dns-query#DIRECT`、`https://223.6.6.6/dns-query#DIRECT`。
- 引导 DNS：同样使用上述两条阿里 DoH，并明确直连。
- 直连出口 DNS：优先遵循境外域名策略，其余使用上述两条阿里 DoH。

这些 DoH 地址直接使用 IP，无需先通过系统 DNS 查出 DNS 服务商的域名。节点域名解析可以在代理连接建立前完成，避免解析依赖代理、代理又依赖解析的循环。

配置没有 `system`、明文 DNS 或备用系统 DNS 回退，也没有跳过 TLS 证书校验。直连加密 DNS 的请求仍经过运营商网络；加密保护查询内容，接收查询的 DNS 服务商仍能看到域名。

`prefer-h3: false` 不优先使用 HTTP/3，配合 `respect-rules` 使用。它只涉及内核 DoH，不修改浏览器的 HTTP/3 设置。

## DNS 接管与手机生效

配置保留 fake-IP，并加入 `tun.dns-hijack` 的 `any:53`、`tcp://any:53`，用于接管进入 TUN 的普通 UDP/TCP DNS。这里没有在 Mac 强制启动 TUN；手机实际接管行为还取决于 VPN、客户端编译结果及其隧道设置。应用自带的加密 DNS、未进入 VPN 的流量不能仅靠这个端口规则覆盖。

手机需要在当前局域网订阅配置中点「立即同步」，保持「随链接更新」开启，并在「配置覆写 → 规则方案」选择「原始配置」（部分界面称为「使用原始配置」），重新启用配置；必要时断开并重新连接 VPN。选择与链接同名的已保存规则方案，会继续使用方案自己的 DNS。单独更新广告规则不会更新 DNS。

同步后可通过 `clash-cli dns explain` 核对运行中的 DNS 选择，并通过受控查询验证实际出口。项目不保存控制器密钥。切换 `上网模式` 选项不保证清除 DNS 缓存或重建已有连接；核对冷启动行为时，应重新连接 VPN 后直接选择目标模式，不先通过其他模式预热。

## 外区 App Store 分流

2026-11-20，用户反馈外区账号的 App Store 在 `PASS` 下提示无法连接，改为 `PROXY` 可以打开。手机当时选择 `Apple=DIRECT`，实际捕获到 `amp-api-edge.apps.apple.com` 连接经过 `Apple → DIRECT`。该域名命中境外 DNS 策略，查询得到 Fastly 地址；独立测试中几个 Apple HTTPS 接口的直连仍能成功，因此这些证据不足以把完整商店故障仅归因于 DNS。

完整配置现增加三条商店分流规则，放在上网模式的两条 NETWORK 规则之后、其他普通分流之前：

```yaml
- DOMAIN-SUFFIX,apps.apple.com,PROXY
- DOMAIN-SUFFIX,itunes.apple.com,PROXY
- DOMAIN-SUFFIX,mzstatic.com,PROXY
```

对应商店页面/API、iTunes 商店接口与下载、静态资源域名及其子域名。广告拦截和局域网直连规则仍先执行。

| 上网模式 | App Store 相关流量 |
| --- | --- |
| `PASS` | 命中上述域名规则，交给 `PROXY` |
| `PROXY` | 由上网模式直接交给 `PROXY` |
| `DIRECT` | 由上网模式直接连接；外区商店不保证可用 |

本次修正增加的是商店分流规则，DNS 段与修正前一致，未增加国内 DNS 特例。其他 Apple 域名继续交给原有的 `Apple` 策略组。

在手机更新完整配置后，保持上网模式为 `PASS`，重新打开 App Store；必要时重新连接 VPN，使新请求按新规则建立连接。单独更新广告规则集不会取得这三条分流规则。

隔离的 Mihomo v1.19.29 通过最小测试配置检查，并用本机模拟直连与代理服务验证 21 个实际 HTTP 路由用例，覆盖三种上网模式、商店域名和普通域名。该测试验证规则选择。

手机同步后，用户确认 `PASS` 下已能打开外区 App Store。读取运行状态确认上网模式为 `PASS`；商店接口 `amp-api-edge.apps.apple.com` 命中新增的 `apps.apple.com` 域名后缀规则，并经 `PROXY → AUTO → 当前节点` 连接。实际商店接口及 `is1-ssl.mzstatic.com` 静态资源连接均命中新规则并有下载数据，说明手机已载入并使用本次分流。

改动前完整配置保存在 `subscription/before-appstore-routing.yaml`，验证记录为 `subscription/appstore-routing-validation.json`。

## 路由器代理场景修正

以下历史验证记录中的 `Ad` 是当时的策略组名称，对应现在的「上网模式」。


2026-11-20，用户反馈手机 VPN 一开始选 `DIRECT` 无法打开 Google，先用 `PASS` 再切回 `DIRECT` 则可以打开。手机当时保留了经代理建立的 DNS 连接，但新建的 `DIRECT` Google 测试仍返回 HTTP 503 / EOF；不能将暂时可用直接归因于问题已解决，也没有证明 DNS 缓存是唯一原因。

同一家庭网络下，路由器 DNS 返回 Google 的 fake-IP，访问正常；Cloudflare DoH 返回的 Google 地址也访问正常。阿里 DoH 当时返回另一个地址，HTTPS 连接失败。旧配置让所有直连域名跳过 DNS 策略、统一使用阿里 DoH，独立冷启动内核复现了 Google TLS 失败。

本次只增加境外域名 DNS 策略并开启直连解析遵循策略；仍使用加密 DoH，DNS 出口继续按 `Ad` 和路由规则决定。修改前完整配置保存在 `subscription/before-direct-dns-policy.yaml`。

全新隔离内核对照结果：

| 验证项 | 结果 |
| --- | --- |
| 旧配置，`Ad=DIRECT`，手机代理不可用 | 复现 Google TLS 连接失败 |
| 修正后，`Ad=DIRECT`，`PROXY=REJECT` | Google 返回 204，百度返回 200；Cloudflare / Google 与阿里 DoH 均走直连 |
| 修正后，`Ad=PROXY` | 查询成功，境外 DoH 经过 `Ad → PROXY → 节点` |
| 修正后，`Ad=PASS` | 查询成功，境外 DoH 继续匹配后续规则，经过 `PROXY → 节点` |
| 修正后，`Ad=PROXY`，`PROXY=REJECT` | 查询按预期失败，未改走直连解析 |

完整修正配置通过官方 Mihomo v1.19.29 检查。报告为私有目录 `subscription/dns-router-validation.json`。随后在手机 Mihomo v1.19.34 实际确认：下载的修正配置 SHA-256 一致，Google DNS 命中 `policy` 并使用 Cloudflare / Google DoH，当前 `Ad=DIRECT`，新建 `DIRECT` Google 测试成功，延迟 307 ms。这些结果来自家庭路由器环境；未测试手机移动网络，也未修改路由器设置。

## 前一版验证记录与范围

2026-11-20，完整配置通过官方 Mihomo v1.19.29 语法检查。每种模式分别启动全新的隔离内核，使用相同 DNS 段、一条现有 VLESS 节点以及 `Ad` / `PROXY` 组，避免切换时复用旧 DNS 连接。隔离测试不启动 TUN，不修改正在使用的手机策略组。

| 验证项 | 结果 |
| --- | --- |
| `Ad=PROXY` | 查询成功，观察到 DoH 连接经过 `Ad → PROXY → 节点` |
| `Ad=PASS` | 查询成功，测试中的 DNS 连接继续匹配后续规则，经 `PROXY → 节点` |
| `Ad=DIRECT`，同时将 `PROXY` 设为 `REJECT` | 百度 HTTPS 返回 200，阿里 DoH 连接为 `DIRECT`；当时未覆盖 Google 冷启动 |
| `Ad=PROXY`，同时将 `PROXY` 设为 `REJECT` | DNS 查询按预期失败，没有成功建立直连解析连接，内核继续运行 |
| 局域网下载 | 完整配置及两份规则下载成功，SHA-256 均与本机文件一致 |

首轮使用另一条节点时，代理查询遇到传输连接 EOF；其后的查询成功。已保留首轮记录，并改用此前正常的「日本4号-0.1倍率」完成上述独立测试。这说明节点可用性仍会影响解析，不能把本次成功测试当作所有节点均可用的证明。

详细结果保存在私有目录 `subscription/dns-validation.json`，首轮记录为 `subscription/dns-validation-first-attempt.json`。完整配置与修改前快照相比，仅 DNS 和 TUN DNS 接管字段发生变化。Mac 临时测试内核已停止并清理。

模板依据：[Mihomo DNS 配置](https://wiki.metacubex.one/config/dns/)、[TUN 配置](https://wiki.metacubex.one/config/inbound/tun/)。上述结果验证文件和 Mac 隔离内核的行为，未验证手机本次同步后的运行状态，也不等同于对所有应用完成 DNS 防泄漏测试。
