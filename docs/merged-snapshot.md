# 七套广告规则精简合并版

这是 2026-11-17 保存快照的合并结果，适用于 mihomo，需要下面两份规则一起启用。

| 文件 | 用途 | 条数 | 大小（字节） |
| --- | --- | ---: | ---: |
| `ads-merged.mrs` | 七套清单的精简域名并集 | 353,223 | 3,161,782 |
| `ads-merged-extra.yaml` | 正则和共享例外条件 | 408 | 40,057 |

域名记录从 1,020,150 条精简为 353,223 条，去除相同条目、父域名已覆盖的子域条目，以及被后缀规则覆盖的精确条目。StevenBlack 原有的精确匹配范围保持不变，只有其他原始规则本来就覆盖子域时才保留相应后缀规则。

AdGuard 的 781 条补充规则先按域名覆盖证明精简为 636 条，再把相同例外条件提取复用，得到 408 条 YAML 条目。合并公共条件保留其全部正则分支，不是丢弃这些分支。

部分主机名正则无法用域名 MRS 完整表达，因此这两份文件构成完整组合。补充 YAML 是为本 MRS 精简后的剩余条件，需要与它配合使用。

## 使用方法

1. 把两份规则文件放到 mihomo 配置目录下的 `rules/merged/`。
2. 参考 `mihomo-example.yaml`，把以下内容合并到客户端的配置扩展或覆写中。
3. 用这两个 provider 替换原来的七套清单和 AdGuard 补充 provider，保留自己原有的后续分流规则。

```yaml
rule-providers:
  ads-merged:
    type: file
    behavior: domain
    format: mrs
    path: ./rules/merged/ads-merged.mrs
  ads-merged-extra:
    type: file
    behavior: classical
    format: yaml
    path: ./rules/merged/ads-merged-extra.yaml

rules:
  - RULE-SET,ads-merged,REJECT
  - RULE-SET,ads-merged-extra,REJECT
  # 后接自己原有的分流规则。
```

这两份是规则集；示例不含代理节点，不能作为节点订阅直接导入。

## 合并语义

合并后的行为对应原来 7 个 MRS 加 AdGuard 补充 YAML 全部使用 REJECT 的并集。原清单中任意一套独立拦截的域名，合并后仍会拦截；AdGuard 的局部例外也保持原作用范围，不会变成覆盖其他清单的全局放行。

域名 MRS 保持原 MRS 的大小写不敏感匹配。补充 YAML 中原有的普通域名条件及正则标志保持原义。看似 IP 的主机名正则继续保留为主机名谓词，没有扩大为目标 IP 段拦截。

本包沿用此前 AdGuard 的 DNS/主机名转换范围，不代表完整浏览器 URL 过滤。此前核实的 9 条 URL、端口和路径特殊规则不适用于有效 DNS 主机名，也未在这里扩大匹配范围。

详细生成记录和覆盖证明在 `build-report.json`；验证结果见 `test-report.json`。

## 验证结果

使用 mihomo v1.19.29，在两个隔离的本地测试内核中对照原 8 个文件与合并后 2 个文件：

- 439,713 条不同的原始域名条目逐条完成覆盖证明，无遗漏、无无依据扩大的域名范围。
- MRS 全量反解得到 353,223 条，与生成输入一致。
- 865,906 个离线主机名用例无差异，包含 8,314 个大小写变体，覆盖 732 条不同正则及其例外条件。
- 16,337 个实际内核用例、32,674 次请求，合并前后 0 差异，独立预期错误 0，测试连接错误 0。其中 16,212 个主机名另与独立预期比较；125 个 IP 字面量目标单独检查两套规则的分流一致性。
- 7,965 个离线用例需要补充 YAML 才能保持原拦截结果，证实只启用本 MRS 会漏掉部分原有规则效果。

测试请求均由本地模拟代理返回，没有访问外部目标网站。验证针对当前快照的转换和匹配，不评估上游规则的误杀率或实际广告效果。

原始 AWAvenue MRS 的 API 头部条数为 981，反解有效条目为 978；覆盖统计使用反解后的条目。两类数量均记录在测试报告中。

## 来源与更新

输入包含 HaGeZi Normal、StevenBlack、AdGuard DNS 转换快照，以及用户提供地址的 anti-AD、AWAvenue、Cats-Team AdRules、217heidai。原三套是此前保存的快照，后四套沿用本次重叠分析时已下载的快照；各项目更新时间可能不同。

- [HaGeZi Normal](https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/multi-onlydomains.txt)
- [StevenBlack](https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts)
- [AdGuard 域名部分](https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt)
- [anti-AD](https://anti-ad.net/mihomo.mrs)
- [AWAvenue](https://raw.githubusercontent.com/TG-Twilight/AWAvenue-Ads-Rule/main/Filters/AWAvenue-Ads-Rule-Clash.mrs)
- [Cats-Team AdRules](https://raw.githubusercontent.com/Cats-Team/AdRules/main/adrules-mihomo.mrs)
- [217heidai](https://github.com/217heidai/adblockfilters/releases/download/rule/adblockmihomo.mrs)

规则内容沿用各上游项目的许可；来源和快照 SHA-256 见 `inputs/manifest.json`（交付包中的 `sources-manifest.json` 是它的副本）。

这是本地文件快照，不会自动更新。完整工作目录保留了输入 MRS 和 AdGuard 补充规则，可使用 Python 3.9+ 和 mihomo 从这些快照重建并验证：

```sh
python3 build_merged.py "/你的/mihomo/核心路径"
python3 validate_merged.py "/你的/mihomo/核心路径"
```

脚本使用项目内保存的输入，不重新下载源，不改动正在使用的客户端配置，也不修改系统代理、DNS 或 hosts。
