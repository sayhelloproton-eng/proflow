# Real-3 Round｜Dev Tunnel Login Timeout Evidence

日期：2026-09-02

## 真实现场

- Product Workspace：`dev-tunnel@0.1.27`。
- `platform setup` 两次真实重放仍停在 `Dev Tunnel login status is UNKNOWN`，未拉起 GitHub Auth。
- 一次 managed CLI acquisition `unzip` 异常未复现；官方 artifact SHA 与 pinned SHA 一致，`unzip -t` PASS，独立解压约 6.6s，未升级为稳定根因。

## 登录机械证据

- managed `user show --json` 最终 stdout：`{"status":"Login token expired"}`。
- verbose 输出：`The cached access token for GitHub account ... expired at ...`。
- 同一 0.1.27 automation 在命令 10s 内返回时能正确进入 browser-login branch。
- 0.1.27 timeout 路径会跳过 primary JSON evidence；default runner timeout 还会覆盖 partial stderr。

## 根因与候选修复

根因不是 parser、版本物化或登录设计，而是 timeout evidence consumption。候选修复：primary timeout 时先解析已返回 JSON/text；只有 UNKNOWN 才 verbose；timeout 保留 partial stderr。

Gate：`automation.test.ts` 19/19 PASS；其余 dev-tunnel tests 20/20 PASS；合计 39/39 PASS；typecheck PASS。

## 2026-09-03 续证：登录闭环与 port-list 瞬时异常

- 登录时延问题已通过后续最小修复闭环：真实 `user show --json` 两次 authority readback 分别约 11.847s / 10.604s，证明历史 10s 窗口不足；正常与 post-login confirmation 统一使用更宽的 bounded window，UNKNOWN fail-closed 语义不变。
- `dev-tunnel@0.1.30` 已真实 publish、Registry exact readback PASS，并通过公开 `platform update --package` 物化到 Product Workspace。
- 真实 `platform setup` 已跨过登录阶段且未再次打开 Browser Auth，证明 authenticated state 被正确复用。
- 随后一次 setup 在 `devtunnel port list --json failed or timed out` 停止；该现象与 Deployment Final Freeze 中已出现并被用户裁决 `NOT_BLOCKER` 的单次 port-list failure 同类。
- 对同一 stable tunnel `proflow-aeb1e6d087caaf089de01d41` 做一次只读 authority readback：`port list` exit=0，elapsed=20.147s，JSON parse PASS，port 41705 / protocol=http 仍存在。
- 因此当前没有证据支持“port 被回收”或“45s timeout 稳定不足”；本次裁决为上游瞬时查询异常，不扩 timeout、不发新版本、不重开 Deployment。
- 当前恢复方向：复用既有 stable tunnel/port，恢复 host/public forwarding → platform lifecycle → Real-3 J0→J4。
