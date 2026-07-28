# lotm-domain — LOTM 领域特有逻辑

## 何时使用

- 设计/修改晋升（promotion）相关模块
- 设计/修改扮演（acting）系统
- 设计/修改秘密揭示（secrets/reveal）逻辑
- 设计/修改战斗裁决（combat exchange）
- 添加/修改能力索引（ability lookup）
- 需要了解 LOTM 世界观边界和设定约束
- 排查晋升/扮演/战斗相关的领域逻辑 bug

## 必须先读

### 核心引擎文件

1. `engine/core/state/state-enum-schemas.ts` — **所有枚举**：PathwayId（22 标准 + 10 外神 + custom）、SequenceRank（13 级）等
2. `engine/core/state/pathway-names.ts` — 中文名映射 + abilityLookupKey 格式
3. `engine/core/actor/acting.ts` — 扮演系统核心算法：
   - `computeActingWeightedScore` — 求和公式（intensity + narrativeWeight）
   - `checkDigestionTimeCondition` — 1 个月时间闸
   - `getActingReadiness` — 阈值：raw(＜20) / partial(20-49) / ready(50-99) / overprepared(≥100)
4. `engine/core/promotion/promotion-exchange-lotm.ts` — 晋升裁决：
   - 6 种 outcome band、3 种 tier gap、4 种 ritual integrity、4 种环境风险
   - 成神特判、无主材料强制 stabilized
5. `engine/core/combat/combat-exchange-lotm.ts` — 战斗裁决：
   - 6 种 outcome、6 种 stateLanding、8 种 tactic、4 种 riskTolerance
   - 秒杀阈值 |combinedDelta| >= 4
6. `engine/core/combat/lotm-rank.ts` — 等级比较基础（power value 表）
7. `engine/core/knowledge/secrets.ts` + `semantic-reveal.ts` — 秘密系统：
   - 3 种秘密类型（actor-beyonder / actor-private / world-fact）
   - 4 种 reveal outcome（revealed / foreshadowed / insufficient-evidence / incorrect）
   - LLM 推理 + 关键词回退

### 数据文件

8. `data/mechanics/` 全部 MD 文件 — LOTM 设定知识核心
9. `data/config/神之途径.json` — 序列名 ↔ 途径映射（一切途径数据的源头）
10. `data/pathways/pathways_promotion.json` — 晋升材料数据
11. `data/mechanics/序列阶级.md` — 序列等级体系
12. `data/mechanics/相邻途径.md` — 相邻途径关系
13. `data/mechanics/非凡特性定律.md` — 非凡特性基本定律

## 项目内已有的能力与模块

### 序列等级体系

| Power | 等级     | 层次     |
| ----- | -------- | -------- |
| 0     | ordinary | 普通人   |
| 0.5   | seq-9    | 低序列底 |
| 1     | seq-8    | 低序列顶 |
| 4     | seq-7    | 中序列底 |
| 4.5   | seq-6    | 中序列   |
| 5     | seq-5    | 中序列顶 |
| 8     | seq-4    | 圣者底   |
| 8.5   | seq-3    | 圣者顶   |
| 12    | seq-2    | 天使底   |
| 12.5  | seq-1    | 天使顶   |
| 16    | seq-0    | 真神     |
| 20    | old-one  | 旧日     |
| 24    | pillar   | 支柱     |

层内差 0.5~~1，层间差 3~~3.5，反映巨大实力鸿沟。

### 扮演系统流程

1. GM 记录扮演行为 → `record_acting_feedback`（intensity + narrativeWeight）
2. 引擎计算加权总分（简单求和）→ 判断消化准备度
3. 检查时间闸（最早记录距今 ≥ 1 个月）
4. 晋升时调用 `resolveLOTMPromotion` → 自动考虑扮演准备度

### 晋升裁决流程

1. 检查 actor 存在性、序列状态（首次晋升需 pathway）
2. 加载 `LOTMPromotionInput` 9 个输入字段
3. 计算 `total = rankDelta + modifier`（整合 ritual、environment、acting、materials）
4. 映射到 6 种 outcome band
5. 生成 stateLandings（6 种）、consequenceGuidance、narrativeConstraints

### 战斗裁决流程

1. `compareLOTMRanks` 计算等级差 baselineTierDelta
2. `resolveEquipmentComparison` 设备补正（±0.5 per 级）
3. `combinedDelta = baselineTierDelta + equipmentComparison`
4. 根据 combinedDelta + riskTolerance 确定 6 种 outcome 之一
5. 生成 stateLandings、consequenceGuidance、narrativeConstraints

### 秘密揭示流程

1. 收集候选秘密（actor 的未揭示 + world 的 hiddenWorldFacts）
2. 无候选 → `insufficient-evidence`
3. 调用 `judgeSecrets`（LLM）判断每条候选秘密
4. 根据 verdict（revealed/hinted/unrelated）更新 revealState
5. revealed → 同步到 public memory → 返回 `revealed`
6. hinted → 返回 `foreshadowed`
7. 否则 → `insufficient-evidence`

### 能力索引

- 数据源：`data/abilities/pathway_abilities.json`（354 条目）
- 索引 key 格式：`"{中文途径名}途径-{序列标签}"`（如 `"占卜家途径-序列9"`）
- 3 种查询方式：途径-序列查询、序列名称查询、能力名称搜索

## 枚举键与中文名对照表

数据映射路径：

```
PATHWAY_DISPLAY_NAMES[pathwayId] + "途径-" + RANK_DISPLAY_NAMES[rank]
→ "占卜家途径-序列9"
```

注意：英文枚举键使用 kebab-case（如 `secrets-suppliant`），中文名通过 `PATHWAY_DISPLAY_NAMES` 映射。

## 验证命令

```bash
pnpm typecheck        # 编译检查
pnpm test             # 引擎测试 + 工具测试
# 特定模块测试
node --test 'engine/core/actor/acting.test.ts'
node --test 'engine/core/promotion/promotion-exchange-lotm.test.ts'
node --test 'engine/core/combat/combat-exchange-lotm.test.ts'
node --test 'engine/core/knowledge/secrets.test.ts'
```

## 已知领域模型限制

1. **相邻途径支持缺失**：没有「相邻途径特性消化」的概念
2. **多序列扮演缺失**：角色不能同时拥有多个序列途径的扮演进度
3. **时间闸固定 1 个月**：没有按序列等级调整
4. **tierGap 判定偏差**：按 targetRank 而非 rankDelta，某些跳跃归类不准确
5. **`incorrect` outcome 未使用**：`RevealSecretOutcome` 包含但 `revealSecret` 从未返回
6. **LLM 模型较弱**：Qwen3.5-4B 对复杂 LOTM 设定推理可能不够准确，关键词回退非常基础
7. **`data/wikis/` 未填充**：`data/wikis/lotm/` 和 `data/wikis/loom/` 均为空，日后可把 `data/` 下的内容按需挑重点放进去。当前世界知识在 `data/mechanics/`（核心设定）、`data/characters/`（角色）、`data/locations/`（地点）等目录中。
8. **无失控值（Corruption/Insanity）系统**：actor-condition 提到但无专门数值系统

## 容易违反的 LOTM 设定

1. ❌ 序列不能跨途径直接融合（除非相邻途径的唯一性/序列1聚合）
2. ❌ 扮演是消化魔药的唯一方式（不能跳过）
3. ❌ 无主材料不可能晋升（引擎通过 `hasMainCharacteristic=false + total < 2 → stabilized` 强制执行）
4. ❌ 等级压制巨大（低序列对高序列几乎没有胜算）
5. ❌ 仪式直接影响晋升结果
6. ❌ 成神需要非凡代价（特判确保 catastrophe 或 scarred-success）
7. ❌ 秘密双层结构：hidden-canonical → public 必须通过 `reveal_secret` 工具
8. ❌ 战斗必须有落地状态（stateLandings 强制记录）

## 数据依赖图

```
data/config/神之途径.json
  │
  ├── → data/abilities/pathway_abilities.json（能力数据）
  ├── → data/pathways/pathways_promotion.json（晋升配方）
  └── → engine/tools/lookup/sequence-lookup.ts（序列名索引）
        engine/core/state/pathway-names.ts（中文名映射）
```

## 禁止事项

- ❌ 不要在叙事中直接揭露 hidden-canonical 秘密 — 必须走 `reveal_secret` 工具流程
- ❌ 不要绕过 stateLandings 直接写状态变化 — 晋升/战斗的落地状态必须记录
- ❌ 不要修改 `lotm-rank.ts` 的 power value 表而不同步修改战斗/晋升系统
- ❌ 不要修改 `pathway-names.ts` 的中文名映射而不同步更新 `pathway_abilities.json`
