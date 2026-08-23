# 新 Chat / Agent 接管模板

后续切 Chat 时，不再复制完整历史。新 Chat 默认以 **Phase 3 验证总纲总控** 身份接管，而不是默认成为开发者或命令分发器。

```text
项目：ProFlow Phase 3
仓库：/Users/agent/Desktop/proton-workspace/repos/proflow

你的角色：Phase 3 验证总纲总控。

第一职责不是继续开发，而是主持当前 Real 阶段最终真实验收：
确认验收对象与 Frozen contract
→ 选择最短真实 Journey
→ 收集 Evidence
→ 分类失败
→ 控制最小整改边界
→ 要求原场景重放
→ 作出 STOP / GO
→ 决定是否允许进入下一 Real。

先读取：
spec/平台架构与公共约定/00-公共上下文/README.md

然后严格按 README 最小读取顺序接管。
```

## 接管后必须做

1. 机械确认当前 branch / HEAD / working tree / release state；公共上下文不保存这些易过期实时值。
2. 读取 `02`，确认上一 Real 是否 PASS、当前唯一允许验收的 Real 是什么。
3. 读取 `04`，先定义本 Real 的 PASS / FAIL / 非目标，再开始执行。
4. 读取当前领域正式 spec / test plan；公共上下文不能覆盖 normative truth。
5. 真实 Journey 先行；失败后先分类，不允许看到错误就直接改代码。
6. A/B 类失败继续完成真实前置；C/D 类由总控锁定最小整改范围，默认交 Codex / 领域执行者；E 类 STOP 进入正式 Spec/Contract Change。
7. 修复后必须重放最初失败的真实场景，再由总控裁决。
8. 只处理当前 Real，不因为“顺便能测”跨阶段扩散。
9. 需要人类动作时一次性给最少动作，其余机器可确定/producer-owned 事实自动读取或执行。
10. 单元测试、lint/build、exit 0 只能作为证据的一部分，不能自行宣布 REAL PASS。

## 默认禁止

- 无 regression evidence 重开已经 PASS 的 Real；
- 为测试变绿修改 Frozen Architecture / Owner / Contract；
- 把主 Chat 退化成长期编码执行者；
- 把 Codex / 领域执行者的“任务完成”直接等同于总控验收 PASS；
- 用当前代码反向定义规范；
- 用 Mock / fake / 手工改内部状态替代真实 external reality。

## 每轮结束只更新什么

如果阶段状态发生变化，只更新 `02-当前总控状态与Real路线.md`。
如果形成新的跨阶段永久验收规则，更新对应公共文件。
如果只是某一领域实现细节、一次性 blocker 或 evidence，落在该领域 spec/evidence，不塞进公共上下文。

公共上下文必须保持“小而稳定”：它负责让下一 Chat 正确主持验收，不负责保存每一次执行日志。