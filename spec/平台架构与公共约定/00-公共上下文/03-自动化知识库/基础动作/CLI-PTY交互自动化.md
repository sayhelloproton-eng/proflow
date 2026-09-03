# Primitive｜CLI / PTY 交互自动化

> 目标：稳定驱动真实交互 CLI，避免新 Chat 重新猜 Enter、方向键、prompt transport。

## 默认策略

普通 CLI 的 Yes/No、文本输入、菜单、取消、重试由 ChatGPT 自动完成，不机械转交用户。简单 prompt 可用 Local Dev PTY；**同一个 prompt 的文本注入一旦证明不可靠，就立即切既有 expect/pexpect harness，不在坏 transport 上反复发 Enter。**

ProFlow `platform setup` 的 canonical 交互 harness：

```text
scripts/human-e2e/platform-setup.exp
```

已有 canonical harness 时禁止临时再写第二套 `/tmp/*.expect`、AppleScript 或随手 shell 交互脚本。

## Clack / 终端尺寸

父终端宽度不等于 Expect 创建的 child PTY。对会按终端宽度重绘的 Clack 交互，必须在**真正执行产品命令的 child PTY 内**先设置 rows/columns，再 `exec platform ...`；否则提示可能逐字符换行，导致语义 matcher 失效。

## Prompt 状态机

每个公开问题只响应一次，matcher 必须匹配具体 prompt 语义：

```text
observe exact prompt
→ send one intended answer
→ observe state transition / next prompt / terminal result
```
禁止宽泛规则如“看到 Yes 就 Enter”、连续盲发 Enter、用方向键猜默认值。交互发送成功不等于产品状态已改变；最终以 CLI 输出、Owner status 和真实外部状态确认。

## 与 Browser / setup 的边界

CLI harness 只驱动终端 prompt。若 `platform setup` 拉起 Browser OAuth / GitHub Auth / ChatGPT 页面，浏览器阶段切到 `Browser-UI自动化.md`，完成后继续**同一个 setup PTY 事务**；不要重新启动第二个 setup。

Browser Extension 的系统 UI 安装由 canonical Browser helper 负责，不把 AX/文件选择器动作塞进临时 Expect。

## 日志与安全

Harness 可记录 prompt、选择结果、exit code、phase timing；禁止记录 secret/token/credential。测试机器人自身的 matcher、PTY、焦点或编译错误记为 `HARNESS_OVERHEAD`，不能算产品 happy-path 性能。
