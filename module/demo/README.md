# Clash-Client 覆写脚本与功能模块 demo

这里包含两个独立的简单示例：`demo.js` 用于「覆写脚本」，`demo.sgmodule` 与 `module.js` 用于「模块」。

本示例独立于原来的完整配置、节点、DNS 和订阅服务。

实际使用的[知乎去广告模块](../zhihu/README.md)和[爱奇艺去广告模块](../iqiyi/README.md)位于各自目录，与下方的简单 demo 分开。

## 覆写脚本 demo

在「覆写脚本」的添加脚本输入框中填写：

```text
http://192.168.2.77:18765/demo/demo.js
```

粘贴链接后，先按键盘右下角的「完成」（Return）触发下载，等待脚本列表出现 `demo`，再保存。仅填写链接并点击页面右上角「保存」不会提交链接，列表仍会为空。输入框旁的专用粘贴按钮也会触发导入。

这个脚本通过 `main(config)` 返回修改后的配置，在策略组列表末尾增加一个「覆写 Demo」组，成员只有 `DIRECT`。将脚本选用于配置并生效后，即可在策略组列表中看到它。重复执行不会添加同名组。

它保留已有节点、DNS 和规则，只增加一个未被规则引用的演示组，不改变原有流量分配。这里只读入、变换运行配置，不修改电脑上的 `subscription/config.yaml`。

## 模块 demo

模块导入地址：

```text
http://192.168.2.77:18765/demo/demo.sgmodule
```

该模块声明请求匹配条件，并调用 `module.js` 生成响应；这份 `module.js` 使用 `$request`、`$done`，应由模块加载。「覆写脚本」入口使用上面的 `demo.js`。

模块启用且请求经过 Clash-Client 的模块引擎时，访问：

```text
http://module-demo.invalid/hello
```

脚本直接返回 HTTP 200 和 JSON：

```json
{
  "message": "模块和脚本运行成功",
  "module": "模块",
  "script": "module.js",
  "request": "http://module-demo.invalid/hello"
}
```

这是专用的 HTTP 测试地址，脚本不请求真实网站，不需要节点信息或 HTTPS 解密证书。模块和脚本都会核对地址，只处理 `/hello` 和它的查询参数，其他地址保持原样。未启用模块时，`.invalid` 测试域名本身不能访问；不要替换为 HTTPS。

## 文件

| 文件 | 用途 |
| --- | --- |
| `demo.js` | 独立覆写脚本，通过 `main(config)` 增加演示策略组 |
| `demo.sgmodule` | 客户端功能模块，声明 URL 匹配和脚本下载地址 |
| `module.js` | 客户端执行的脚本，通过 `$done({ response: ... })` 直接生成响应 |
| `../serve.py` | 提供客户端文件下载，明确声明 UTF-8 编码，避免浏览器中文乱码 |

## 客户端导入地址

当前 Mac 的局域网地址已填为 `192.168.2.77`，demo 文件使用独立的 `18765` 端口提供下载：

```text
http://192.168.2.77:18765/demo/demo.sgmodule
```

在 Clash-Client 的模块添加界面使用这个链接，客户端下载模块和 `module.js`，然后启用模块。

下载服务命令如下；当前会话已启动服务时，无需重复运行：

```sh
python3 module/serve.py
```

该服务仅用于提供本目录内的 demo 文件。JS、模块和 Markdown 以 `text/plain; charset=utf-8` 提供，避免浏览器猜测编码或将脚本当作执行资源；响应禁用缓存，并对带旧缓存条件的请求重新发送正文和编码头。原有 `8765` 订阅服务继续运行。脚本根据自身位置定位文件，从其他目录也能启动。Mac IP 变化时，需同步更新模块中的 `script-path` 下载地址。

项目根目录运行 `python3 -B -m unittest discover -s tests` 可检查中文下载、HEAD 响应、旧缓存更新和二进制文件原样传输。

## 格式依据

已核对 Clash-Client 源码支持的 Surge 风格模块语法、`http-request` 脚本和直接响应接口：

- [ScriptEngine.swift](https://github.com/ProjectClash/Clash-Client/blob/main/apple/ClashClient/Sources/ConfigUI/ScriptEngine.swift)：覆写脚本的 `main(config)` 入口。
- [ProfileOverrideView.swift](https://github.com/ProjectClash/Clash-Client/blob/main/apple/ClashClient/Sources/ConfigUI/ProfileOverrideView.swift)：链接输入框通过键盘提交或专用粘贴按钮发起下载，页面「保存」按钮用于保存覆写设置。
- [ModuleLineSyntax.swift](https://github.com/ProjectClash/Clash-Client/blob/main/apple/ClashClient/Sources/ConfigStore/ModuleLineSyntax.swift)
- [ModuleScriptContract.swift](https://github.com/ProjectClash/Clash-Client/blob/main/apple/ClashClient/Sources/ConfigStore/ModuleScript/ModuleScriptContract.swift)

