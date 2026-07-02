# diagnosis — 常见问题排查

## 何时使用

- 工具调用成功但状态没写
- 状态重新加载后丢失
- `commit_turn` 被拒绝
- 工具调用返回 schema validation 错误
- GM 抱怨 "backstage pending" 卡住
- 状态不一致或引用断裂
- 角色扮演消化不更新

## 必须先读

- `engine/core/state/session-persistence.ts` — 持久化两种路径
- `engine/core/state/state-store.ts` — store 操作
- `engine/core/state/state-schema.ts` — `parseStateSchema` 和 `assertStateInvariants`
- `engine/tools/system/domain-tool-runner.ts` — `runDomainEventTool` 流程
- `engine/core/ledger/obligations.ts` — obligations 机制
- `engine/core/backstage/backstage-obligation.ts` — backstage 义务阻塞

## 排障检查清单

### A. 状态未持久化（工具返回成功但重启后丢失）

- [ ] 工具是否走 `runDomainEventTool` 模式？
  - 是 → 自动处理 persist，确认 `sessionManager` 传入正确
  - 否 → 确认调用了 `commitState(draft)` + `persistStateAfterCommit(sessionManager, details)`
- [ ] `commitState` 前是否有 throw？（execute 抛错会跳过 persist）
- [ ] 重新加载后检查 session entry 是否存在
- [ ] 检查是否在 execute 之外直接修改了 state（绕过了 store）

### B. 工具调用报错

- [ ] 错误是否来自 `parseStateSchema`（hydration 阶段）？
  - 错误格式：`状态./fieldName: expected <type> but got <actual>`
  - → 检查 state JSON 的字段格式、引用断裂（actor 不存在等）
- [ ] 错误是否来自 execute（业务逻辑）？
  - 错误格式：`actor 不存在: xxx` / `资金不足: 账户xxx`
  - → 检查 error message 中的实体 ID、参数值

### C. commit_turn 被拒绝

- [ ] `assertNoOpenObligations` throw？→ `obligations[]` 有未清账的裁决义务
  - 查看 `draft.public.obligations` 数组内容
  - 每个 obligation 有对应的 `settleOldestObligation` 调用
- [ ] `assertNoOpenBackstageObligation` throw？→ `backstageObligations[]` 有未清账的后台义务
  - 查看 `draft.secrets.backstageObligations` 数组内容
  - 触发 trigger：time-advance(≥120min) / beat-complete / no-cost-streak(≥6)

### D. state-schema 校验失败

- [ ] actor registry key 与 actor.id 不匹配
- [ ] 删除 actor 后 scene.presentActorIds / trackedItem.ownerActorId 等引用未清除
- [ ] factionClock.filled > size
- [ ] 纯空白字符串（trim 后空 → minLength:1 拒绝）
- [ ] 浮点数出现在 Integer 字段

### E. 扮演消化不更新

- [ ] `record_acting_feedback` 调用成功但消化度没变 → 检查 `computeActingWeightedScore` 分数
- [ ] 时间闸不满足 → 最早记录距今 < 1 个月
- [ ] actor 没有 sequence（普通人不需要扮演 → 调用会跳过）

## Schema field missing vs Domain missing 区别

| 维度     | parseStateSchema                    | execute                      |
| -------- | ----------------------------------- | ---------------------------- |
| 时机     | hydration（加载/重置）              | tool 调用时                  |
| 频率     | 每次加载一次                        | 每次工具调用                 |
| 错误范围 | 全部字段 + 所有引用                 | 当前操作涉及的实体和规则     |
| 错误类型 | 格式/缺失/引用断裂                  | 业务逻辑/实体不存在/资金不足 |
| 修复难度 | 可能需要重建 state                  | 改参数或补偿状态即可         |
| 典型场景 | 存档 corrupted / 手动编辑 JSON 出错 | GM 操作违反规则              |

## Tool Description 与 Schema 不同步排查

- [ ] schema 变更后是否同步更新了 tool 的 `description` 字段？
- [ ] LLM 调用出错时，错误路径里的字段名是否在 description 中对应存在？
- [ ] 新增/删除字段后是否更新了 agent 侧的 tool-use 文档？
- [ ] description 中的枚举值是否与 schema 一致？

## obligations 阻塞排查

Obligations 是工具间协调的关键机制：

1. 裁决工具产生 obligation（如 combat exchange 的 `recordObligation`）
2. 对应领域事件落地后调用 `settleOldestObligation`
3. `commit_turn` 开始时检查 `assertNoOpenObligations`

**8 种 obligation kind 及落地方式**：

| kind            | 落地工具/方式                                    |
| --------------- | ------------------------------------------------ |
| scene-objective | commit_turn 的 add-objective / resolve-objective |
| scene-threat    | commit_turn 的 add-threat / clear-threat         |
| actor-condition | update_actor_condition 或 commit_turn            |
| equipment       | combat-exchange 装备状态变化                     |
| sequence        | upsert-sequence 或 commit_turn                   |
| memory          | record_memory 或 commit_turn                     |
| reveal-secret   | reveal_secret tool                               |
| tracked-item    | update_tracked_item 或 commit_turn               |

## 常见错误信息速查

| 错误信息                            | 原因                         | 解决                                       |
| ----------------------------------- | ---------------------------- | ------------------------------------------ |
| `本轮存在未落地的裁决义务`          | obligations 未清账           | 检查 obligations 数组 → 对应的领域事件落地 |
| `上一轮后台推进尚未 landing`        | backstage obligations 未清账 | 使用 settle_backstage 工具清账             |
| `actor 不存在: xxx`                 | actorId 无效或已删除         | 检查 actorId 拼写或先 upsert_actor         |
| `资金不足: 账户xxx`                 | 经济系统余额不够             | 检查 purse 余额或调整金额                  |
| `faction clock 不存在: xxx`         | clockId 无效                 | 检查已创建的 faction clocks                |
| `非法 faction clock`: filled > size | clock 数据损坏               | 修复 filled/size 值                        |
| `tracked item 不存在: xxx`          | itemId 无效或已删除          | 检查 itemId                                |
| `状态./fieldName: expected type`    | schema 校验失败              | 检查 state JSON 对应字段的格式             |

## undefined 检查须知

项目未启用 `noUncheckedIndexedAccess`，但 Record 类型访问可能返回 undefined。

**所有 `Record<ActorId, T>[key]` 访问前必须检查**：

```ts
const actor = draft.public.actors[actorId];
if (actor === undefined) throw new Error(`actor 不存在: ${actorId}`);
// 安全访问 actor.property
```

以下 Record 类型都需要此检查：

- `state.public.actors: Record<ActorId, PublicActorState>`
- `state.secrets.actorStates: Record<ActorId, SecretActorState>`
- `state.public.trackedItems: Record<ItemId, TrackedItemState>`
- `state.public.actorImpressions: Record<ActorId, ActorImpression>`

## 验证命令

```bash
pnpm test         # 整体测试
# 手动检查 session entry
cat state/state.json | jq '.'
# 检查 state schema 版本
grep "CURRENT_STATE_SCHEMA_VERSION" engine/core/state/state.ts
```
