# chrome-runtime — Chrome 运行环境

## 模块定位与作用

确保并观察本机真实 Google Chrome，为 Browser Extension 和 ChatGPT 页面操作提供受治理的浏览器运行环境。

## 主要能力

- `Module.install` 先探测 Chrome；已安装时直接复用，不重复安装。
- macOS 未安装 Chrome 时，从 Google 官方 Stable DMG 自动下载、安装并重新验证版本。
- 优先安装到 `/Applications`；当前用户无写权限时使用 `~/Applications`，不要求用户填写 executable path。
- `status` 始终重新探测真实 Chrome，不把历史文件当成当前可用性。

## 提供的 API 与 Public Contract

- 不提供新的逻辑 Contract；通过 Module status 暴露当前浏览器事实。
- `configSlots = []`；Chrome 路径属于机器可发现事实，不是用户配置。
- 标准 start/stop 不接管用户浏览器会话。

## 依赖的 Module、Contract 和外部资源

- macOS 自动安装使用系统 `curl`、`hdiutil`、`ditto` 与 Google 官方 Chrome Stable DMG。
- 当前自动安装实现只在 macOS 启用；其它系统仍可探测已有 Chrome，但缺失时 fail-closed。
- 无上游 Module Contract 依赖。

## 运行形态与生命周期

类型为 External Resource。Chrome 是用户拥有的外部应用；ProFlow 负责确保部署前置存在并观察其现实，不拥有用户标签页或浏览历史。

## 使用方式

正常用户不单独配置本模块。`platform install` 的第一部署步骤负责确保 Chrome；随后 `platform status` 可看到 `chrome-runtime.setupStatus=READY`。Browser Extension 的加载属于后续独立步骤。

## 职责边界与限制

不读取浏览历史，不擅自关闭或导航用户标签页，也不把“Chrome 已安装”误当成 Extension 已就绪。`uninstall` 不删除用户 Chrome。

## 术语

- **Chrome Runtime**：本机可被 ProFlow 确定性发现和验证的 Google Chrome 应用。
- **External Resource**：由用户/厂商拥有、ProFlow 只负责确保存在并观察当前现实的部署资源。
