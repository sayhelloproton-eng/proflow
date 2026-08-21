# chrome-runtime

Chrome Runtime（Chrome 运行环境）检查本机是否有可用的 Chrome，并确认浏览器能够承载 ProFlow 扩展。

## 什么时候需要

安装平台、Chrome 路径变化或浏览器无法启动时使用。

## 工作方式

模块会自动检查常见安装位置和 PATH（命令搜索路径）。通常无需人工配置，也不会替用户关闭正在使用的 Chrome。

如果自动发现失败，`platform setup` 会给出需要选择的浏览器路径。
