# vpn-config

本项目同时维护广告规则和手机完整配置的局域网订阅。

双击 [index.html](index.html) 可打开离线代理配置转换器，将 SOCKS5 / HTTP 代理信息生成为 FlClash / Mihomo、sing-box 或 v2rayNG 配置，支持预览、复制和下载。

Clash-Client 客户端及 `inputs/` 中七套广告规则的 GitHub 仓库、上游下载地址和文件对应关系，统一记录在[客户端与广告规则来源](docs/客户端与广告规则来源.md)。

## 在线访问

| 类型 | 地址 | 说明 |
| --- | --- | --- |
| 网页预览 | [raw.githack](https://raw.githack.com/s20210117/vpn-config/main/index.html) | 将仓库中的 `index.html` 渲染为网页，可直接使用配置转换器。 |
| 备用网页 | [GitHub Pages](https://s20210117.github.io/vpn-config/) | GitHub Pages 部署的在线页面，可在预览入口不可用时使用。 |
| 原始文件 | [GitHub Raw](https://raw.githubusercontent.com/s20210117/vpn-config/main/index.html) | 查看或下载 `index.html` 源码，浏览器通常按纯文本显示。 |
| 文件 CDN | [jsDelivr](https://cdn.jsdelivr.net/gh/s20210117/vpn-config@main/index.html) | 通过 CDN 读取或下载 `index.html` 源码，适合文件分发；HTML 通常按纯文本显示，更新可能有缓存延迟。 |

## 客户端模块

客户端文件统一位于 [module](module/README.md)，并按 `demo`、`zhihu`、`iqiyi`、`huya` 分目录保存。

实际模块见[知乎去广告](module/zhihu/README.md)、[爱奇艺去广告](module/iqiyi/README.md)和[虎牙去广告](module/huya/README.md)。三个模块均可独立导入，不替换完整配置。

示例下载服务使用固定的 UTF-8 文本响应并禁用缓存，避免中文乱码。启动入口：

```sh
python3 module/serve.py
```

该服务使用 `18765` 端口，启动时不会替换手机完整配置或修改下方的 `8765` 订阅服务。导入链接和演示效果见示例说明。

## 手机配置订阅

当前订阅地址：`http://192.168.2.77:8765/config.yaml`。完整配置位于 `subscription/config.yaml`，保存后手机点击「立即同步」即可下载新版本。

首页出站模式保持「规则」，通过排在首位的「上网模式」策略组选择上网方式，成员顺序为 `PASS`（按原有规则分流）、`DIRECT`（直连）、`PROXY`（代理）。该组原名 `Ad`，现已更名；未保存选择时默认使用第一项 `PASS`，客户端已经保存的选择可能继续保留。

配置中的两份广告规则也从这台 Mac 下载，分别对应项目顶层的 `ads-merged.mrs`、`ads-merged-extra.yaml`。修改规则后需在手机更新对应规则集，服务无需重启。已确认的上游误报在构建产物内排除，不通过模块或主配置添加 `DIRECT` 绕行。

双击「启动订阅服务.command」可启动后台服务，关闭终端后继续运行；「停止订阅服务.command」可停止服务。「查看订阅地址.command」显示服务状态。Mac 重启或用户注销后，需要重新启动一次。

完整步骤、更新范围和地址变化处理见 [局域网订阅说明](docs/局域网订阅.md)。`subscription/` 保存含节点凭据的完整配置、备份和验证记录，可随项目一起提交到 Git。

换电脑或网络时，请先查看[迁移依赖与换电脑说明](docs/迁移依赖与换电脑说明.md)，其中列出 IP、端口、系统和手机调试参数的依赖及迁移步骤。

## 广告规则资料

保留七套清单精简合并、规则重建和手机验证资料。整理日期：2026-11-20；规则内容沿用 2026-11-17 保存的快照，本次整理没有刷新上游规则。

早期转换资料已从当前项目移出，项目从约 62.1 MB 精简至约 17.7 MB。完整重建与合并验证所需的 `inputs/`、脚本和记录仍在项目内。

## 直接使用

最终使用顶层的两份文件，需一起启用：

| 文件 | 内容 | 条数 | 大小 |
| --- | --- | ---: | ---: |
| `ads-merged.mrs` | 七套清单合并、去重并排除已确认误报后的域名规则 | 353,220 | 3,161,413 字节 |
| `ads-merged-extra.yaml` | MRS 无法表达的正则和例外条件 | 408 | 40,057 字节 |

把这两份文件复制到客户端配置目录下的 `rules/merged/`，将 `mihomo-example.yaml` 中的 provider 和规则合并进已有配置。两条广告规则放在普通分流规则前，MRS 在前、YAML 在后，策略都选 `REJECT`。

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
  # 后接原有分流规则。
```

这是规则集项目，示例不包含代理节点。手机客户端如支持规则集导入，可以导入两份文件并关联到当前配置；具体路径和界面以客户端为准。普通 `rules` 在内核的规则模式下执行。

## 项目内容

| 路径 | 用途 |
| --- | --- |
| `project.py` | 统一入口：输入快照与生成产物检查、重建、内核对照测试 |
| `build_merged.py` | 从已保存的七套输入重建最终两份规则 |
| `validate_merged.py`、`test_support.py` | 合并前后匹配对照与测试辅助代码 |
| `inputs/` | 七份输入 MRS、AdGuard 补充 YAML、本地误报排除、来源和 SHA-256 清单 |
| `build-report.json`、`test-report.json` | 生成记录和已有验证报告 |
| `validation-cases.json`、`runtime-results.json` | 验证用例和实际内核匹配记录 |
| `docs/客户端与广告规则来源.md` | Clash-Client 及七套广告规则的 GitHub 仓库、下载地址和输入文件对应关系 |
| `phone-tests/` | 2026-11-20 手机验证脚本、报告与说明 |
| `docs/merged-snapshot.md` | 原合并说明，含来源链接、合并语义和详细验证结论 |

早期 `conversion/` 中的转换过程和独立清单已从当前项目移出；日常使用最终两份规则、重建和合并验证不依赖该目录。所有输入规则保留上游来源信息，许可沿用各上游项目。

## 统一命令

在本项目文件夹打开终端。文件检查使用 Python 3.9+，无需额外 Python 包：

```sh
python3 project.py check
```

该命令检查输入快照、生成记录、最终规则产物和 Python 语法，不联网、不启动内核。

订阅与模块下载服务的回归检查使用本机临时服务，无需内核，也不连接手机：

```sh
python3 -B -m unittest discover -s tests
```

重建和完整测试需要另行提供 Mihomo 可执行文件，本项目未附带内核：

```sh
python3 project.py build --mihomo "/你的/mihomo/路径"
python3 project.py test --mihomo "/你的/mihomo/路径"
```

也可在 Mihomo 已加入 PATH 时使用 `--mihomo mihomo`。这些命令在 macOS、Linux 可用；Windows 将 `python3` 换成 `python`，并提供 `mihomo.exe` 的实际路径。

`build` 使用 `inputs/` 保存的快照，更新最终规则和生成记录，并清除旧的合并验证报告；之后运行 `test` 重新生成验证报告。成功后统一入口会检查输入快照、生成记录、最终规则产物和 Python 语法。内核测试启动隔离的本地测试服务，测试请求由本地模拟服务处理，不访问外部广告网站。

更新上游源不是本项目的自动流程。各上游仓库和下载地址见[客户端与广告规则来源](docs/客户端与广告规则来源.md)。重新处理原始 TXT 时需要另行准备转换流程，并同步更新 `inputs/` 的对应输入和来源清单，再重建、验证最终规则。

## 已有验证记录

- 2026-11-17，Mihomo 1.19.29：865,906 个离线用例、16,337 个实际内核用例，合并前后零差异。详细边界见 `docs/merged-snapshot.md`。
- 2026-11-20，手机内核 1.19.34：82 项全部通过，50 次命中补充 YAML、10 次命中 MRS、22 次控制用例正常放行。
- 2026-11-25，Mihomo 1.19.29：应用两项实测误报排除后，865,916 个离线用例、16,328 个实际内核用例均无差异；两个爱奇艺业务后缀正常落入后续分流。

这些是此前保存的测试结果，本次整理只做文件完整性与可运行路径检查。匹配等价测试不衡量真实广告拦截率或上游规则误杀率。

手机脚本保留当时的局域网地址、证书指纹和规则集 ID；再次使用前需核对手机现状。密钥从标准输入读取，项目不保存控制器密钥。该手机匹配接口会增加命中计数，报告中的命中包含人工测试。入口命令不会自动连接手机，详见 `phone-tests/说明.md`。
