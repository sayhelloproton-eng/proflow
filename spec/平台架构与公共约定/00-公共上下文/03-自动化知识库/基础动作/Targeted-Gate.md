# Primitive｜Targeted Gate

> 目标：只验证本轮改动真正影响的包/边界，不把每次局部修复退化成全仓 CI。

## 固定步骤

```text
真实失败
→ CodeGraph 定位 owning package / affected boundary
→ 最小源码修复
→ 最小 targeted regression
→ package typecheck
→ 按发布需要补 build
→ STOP POINT
```

仓库已经提供 canonical package gate：

```text
pnpm package:gate <package-dir|package-name> [...]
```

它对每个目标 package 顺序执行 package `test` + `typecheck`，存在 package `lint` 时一并执行。已有 canonical gate 时不要为同一目的临时拼一套全仓命令。快速修复阶段可先跑最相关 regression + package typecheck；进入发布前若影响范围要求完整包级 gate，再使用 `pnpm package:gate <target>`。

已在同一 candidate 上通过且源码未再变化的 gate 可以继承，不为“保险”重复。若新改动触达此前已通过的代码路径，再重跑对应 affected gate。

完整 package `test` 如果天然长，可按测试文件/语义分批执行并汇总；不要把多个 package test/typecheck/release 串成一个巨型 shell 命令。

## 默认验证上限

局部修复默认：targeted regression + package typecheck；发布包补 build/version consistency。只有正式治理要求或影响范围确实扩大时才加其它 package/full governance gate。

测试 PASS = `SOURCE_FIX=PASS`，不是最终 `FIX=EFFECTIVE`。最终仍需发布、update、真实原场景重放。
