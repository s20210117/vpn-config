# 客户端模块

模块按应用和用途分目录：

| 目录 | 内容 | 导入地址 |
| --- | --- | --- |
| [`demo/`](demo/README.md) | 覆写脚本与模块示例 | `http://192.168.2.77:18765/demo/demo.sgmodule` |
| [`zhihu/`](zhihu/README.md) | 知乎去广告与抓广告诊断 | `http://192.168.2.77:18765/zhihu/zhihu-adblock.sgmodule` |
| [`iqiyi/`](iqiyi/README.md) | 爱奇艺去广告与抓广告诊断 | `http://192.168.2.77:18765/iqiyi/iqiyi-adblock.sgmodule` |
| [`huya/`](huya/README.md) | 虎牙去广告与抓广告诊断 | `http://192.168.2.77:18765/huya/huya-adblock.sgmodule` |

启动下载服务：

```sh
python3 module/serve.py
```

服务根目录就是 `module/`。文件只通过上述分目录地址提供，不保留旧的平铺链接。
