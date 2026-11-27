# Reddit 去广告 1.0.0

正式模块：[reddit-adblock.sgmodule](https://raw.githubusercontent.com/s20210117/vpn-config/main/module/reddit/reddit-adblock.sgmodule)

抓广告诊断：[reddit-capture.sgmodule](https://raw.githubusercontent.com/s20210117/vpn-config/main/module/reddit/reddit-capture.sgmodule)

## 使用

在 Clash-Client 的模块列表添加正式模块，开启 HTTPS 解密并信任对应证书，然后完全退出 Reddit 再重新打开。`debug:true` 记录每次处理数量；日常可改为 `debug:false`。

脚本只处理 `gql.reddit.com/` 和 `gql-fed.reddit.com/` 的 GraphQL 响应：

- 首页、社区、热门、新闻信息流：删除类型为 `AdPost` 或包含 `AdMetadataCell` 的条目。
- 评论区：清空 `postInfoById.pdpCommentsAds.adPosts`。
- 保留正常帖子、评论、未知卡片、分页游标、GraphQL 错误、NSFW 设置与会员状态。无广告、非 JSON、失败响应和未知结构原样放行。

结构依据为 [srcreigh 的原始脚本](https://gist.github.com/srcreigh/2bc8687aace702698d4b8b0b51637bc5)与[作者的 iOS 实测说明](https://www.reddit.com/r/selfhosted/comments/1nxyugk/how_to_block_ads_in_reddit_ios_app_via_selfhosted/)。2026-11-27 的手机日志确认 `gql-fed.reddit.com` 成功解密：脚本执行 365 次，29 次响应实际被修改，累计清理信息流广告 38 条、评论区广告 66 条；未发现证书、脚本解析或超时错误。该结果仅代表本次测试环境，不保证其他版本或接口同样可解密。

两个 GraphQL 主机同时承载正常内容，不添加整域拒绝，也不加入广告 MRS。

## 抓广告诊断

先关闭 Reddit 去广告模块，启用 Reddit 抓广告诊断。电脑运行：

```sh
python3 -B -u module/reddit/capture_server.py
```

从本地模块服务导入诊断模块，会自动填写当前电脑的接收地址，端口为 `18769`。从 GitHub 导入时，在 `collector` 参数填写自己的完整接收地址；默认为 `off`，仅输出本地诊断日志。

彻底退出 Reddit 再打开，依次查看首页、热门、社区和评论区，触发残留广告。记录保存在 `module/reddit/captures/`，只包含接口主机、HTTP 状态、字段结构、GraphQL 类型和数组数量；不上传请求体、查询参数、请求头、帖子正文、用户名或令牌值。诊断始终原样返回响应。

完成后关闭诊断模块，再启用正式模块。若出现 TLS 握手失败、页面加载失败且脚本没有执行记录，关闭两个 Reddit 模块并提供客户端日志，先判断当前版本是否拒绝解密。
