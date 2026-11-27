# 客户端模块

模块按应用和用途分目录：

| 目录 | 内容 | 导入地址 |
| --- | --- | --- |
| [`demo/`](demo/README.md) | 覆写脚本与模块示例 | `https://raw.githubusercontent.com/s20210117/vpn-config/main/module/demo/demo.sgmodule` |
| [`zhihu/`](zhihu/README.md) | 知乎去广告与抓广告诊断 | `https://raw.githubusercontent.com/s20210117/vpn-config/main/module/zhihu/zhihu-adblock.sgmodule` |
| [`iqiyi/`](iqiyi/README.md) | 爱奇艺去广告与抓广告诊断 | `https://raw.githubusercontent.com/s20210117/vpn-config/main/module/iqiyi/iqiyi-adblock.sgmodule` |
| [`huya/`](huya/README.md) | 虎牙去广告与抓广告诊断 | `https://raw.githubusercontent.com/s20210117/vpn-config/main/module/huya/huya-adblock.sgmodule` |
| [`reddit/`](reddit/README.md) | Reddit 去广告与抓广告诊断 | `https://raw.githubusercontent.com/s20210117/vpn-config/main/module/reddit/reddit-adblock.sgmodule` |

知乎与虎牙的域名规则已迁入 `ads-merged.mrs`，请配合合并广告规则集使用。模块继续处理 URL、响应脚本以及知乎 HTTPDNS 的 IP 拦截。先更新广告 MRS，再更新模块。

启动下载服务：

```sh
python3 module/serve.py
```

服务根目录就是 `module/`。文件只通过上述分目录地址提供，不保留旧的平铺链接。

仓库中的模块和脚本地址均使用 GitHub Raw。从本地服务下载模块时，JS 地址会按当前连接的 IP 和端口自动生成，源文件不变；启动输出显示当前模块目录地址。

诊断模块的 `collector` 参数默认为 `off`。本地下载自动填写对应接收器地址；从 GitHub 导入时可在模块参数中填写自己的接收地址。未配置时响应原样放行，不发送诊断记录。
