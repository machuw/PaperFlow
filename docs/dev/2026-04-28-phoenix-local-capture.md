# Phoenix 本地 trace 捕获 (Phase 10 开发期专用)

**生成日期**: 2026-04-28
**用途**: Phase 10 Agent Runtime POC 开发期的本地观测能力。开发者可在 dev menu 触发 agent run 后，在本地 Phoenix UI 中查看完整的 frame 轨迹、工具调用、终止原因等结构化信息——便于调试 #7502 / #7683 等 stopWhen 边界 bug。

> **不在 Phase 10 ship 范围内**: 本文档描述的捕获通道是**仅本地、仅开发期**的可选工具。Phase 14 会评估升级到 Arize SaaS 或 Supabase 区域内自托管。

## 前置依赖

需要在本地机器（不是 Edge Function）安装 Python + arize-phoenix：

```bash
pip install arize-phoenix opentelemetry-sdk opentelemetry-instrumentation-openai
```

## 启动本地 Phoenix

```bash
python -c "import phoenix as px; px.launch_app()"
```

启动后访问 http://localhost:6006 查看 dashboard。Phoenix 的 OTLP/HTTP 收集端点位于 http://localhost:6006/v1/traces。

## 启用 capture

在 PaperFlow reader page 的 DevTools console 中：

```javascript
localStorage.pf_debug_agent = '1'      // 显示 dev-menu 按钮 (Plan 06)
localStorage.pf_phoenix_capture = '1'  // 启用 Phoenix capture (Plan 08)
```

刷新 reader page 后，点击 top-bar 上新出现的 debug 图标即可触发一次 agent run；frame 轨迹会同步 POST 到本地 Phoenix。

## 关闭 capture

```javascript
delete localStorage.pf_phoenix_capture  // 立即生效（下一次 run 不再捕获）
```

或者直接关闭本地 Phoenix 进程——agent-dev-demo 在收集端点不可达时会**静默 skip**，不会打断主流。

## 隐私约定 (CONTEXT.md D-02)

- BYOK apiKey **永远不会**进入 trace payload。capture 路径只取 frame.type / frame.toolName / 短 delta（≤200 字符）等结构化字段。
- 请求 header 不被捕获（含 Authorization + X-BYOK-Authorization）。
- 用户输入的 paper 全文不被捕获（避免 PII 风险——AI-SPEC §1b PII 条款）。

## 故障排查

| 现象 | 排查路径 |
|------|----------|
| dev-menu 按钮不可见 | 确认 `localStorage.pf_debug_agent === '1'`，并刷新页面 |
| 触发后 console 显示 `[phoenix] capture skipped` | Phoenix 未启动；或被防火墙拦截 6006 端口 |
| Phoenix UI 无新 trace | 检查 capture 开关；浏览器 DevTools → Network 查看是否有到 localhost:6006 的请求 |
| dev menu 触发后 reader 主流崩溃 | 与 Phoenix 无关——禁用 `pf_phoenix_capture` 后复测；如仍崩，是 Plan 06 dev demo 本身的 bug |

## Phase 11+ 升级路径

- Phase 11: 把 capture 从 dev-menu 路径迁移到 runAgent 抽象层（默认仍 off）
- Phase 14: 评估 Arize SaaS（受 D-02 安全审核）；或自托管 Phoenix on Supabase region VM
- Phase 14+: Edge Function 端通过 `AGENT_RUN_OTEL_ENDPOINT` env var 启用服务端 OTel exporter（生产默认 off；按 user-id 采样）

---

*相关文档*:
- `.planning/phases/10-agent-runtime-poc-bug/10-AI-SPEC.md` §5 Eval Tooling
- `.planning/phases/10-agent-runtime-poc-bug/10-CONTEXT.md` D-02 BYOK trust-boundary
