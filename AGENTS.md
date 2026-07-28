# AGENTS.md

面向在本项目工作的开发者与编码 agent。

---

## 项目当前形态

`lotm-sandbox` 是在 `fate-sandbox` 的基建上经过 LOTM 的 IP 化处理后转变而来的。它不是一张 prompt 卡；它是本地运行的互动叙事 runtime。

核心组成：

- `agents/`：GM prompt 模块。分工包括 system、context、rules、tool-policy、story-driver、render、style、input-guide、output-contract 等。
- `skills/start-game/`：新游戏初始化流程机。只负责新游戏/重新开始/创建角色，不负责续局或修档。
- `engine/core/`：确定性领域引擎。state、scene、actor、pathway、economy、memory、secret、offscreen 等逻辑在这里落地。
- `tools/`：GM 领域事件工具。工具不是状态栏更新器，而是 GM 改变世界的接口。
- `data/`：LOTM 世界数据、lookup 数据、campaign preset、timeline contract。
- `extensions/`：pi extension。玩家 UI panel、compaction policy、timeline subagent 注入都在这里。
- `.pi/agents/`：项目作用域子代理定义。必须保持 project-only 语义，不依赖 user-scope agent。
- `sessions/`、`state/`、`.pi/agent/`：运行产物/本地私有配置，不属于发布内容，不进 git。

---

## 宪章

本项目是跑在**自己机器上**的东西——没有用户兼容性包袱、没有遗留接口、没有「先这样后面再改」。每一次妥协都会留到下一次、再下一次，最终变成屎山。唯一能拦住这个螺旋的是：**从一开始就不妥协。**

本文件是工程纪律的单一权威源。违反宪章的代码不叫「能跑就行」，叫「不合格」。

### 硬切优先，schema 迁移兜底

项目没有用户兼容性负担。旧概念一旦被判定为错误，就必须从当前契约中消失：

- 不保留 alias、deprecated 字段、兼容 normalizer、旧工具入口或旧 engine public API。
- 不在工具描述、prompt、错误信息里写「不要使用旧字段」；提到旧字段本身就是继续教模型使用它。
- 不用运行时 fallback 读取新字段；state 只能先迁移到当前 schema，再进入业务逻辑。
- 唯一允许的兼容层是 persisted state schema migration。

State schema 变更必须 bump `schemaVersion`，并提供程序化逐版本迁移。迁移链必须是线性的 `v1 -> v2 -> v3`，每个函数只负责相邻版本；禁止写 `v1 -> current`、`v2 -> current` 这种 O(n²) 迁移矩阵。

### Prompt 不是防线

Prompt 负责引导，不能承担正确性。模型常犯错时，优先把约束下沉到 schema、tool boundary、normalizer、engine invariant、migration 和测试。 prompt 也需要改但不如调整 tool desc 和工具返回结果效率。

---

## 工具链基线

| 工具       | 配置                                                                                              | 不可绕过                           |
| ---------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| TypeScript | `tsconfig.json` — `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals` + `noUnusedParameters` | `pnpm typecheck` 零错误才能 commit |
| oxlint     | `.oxlintrc.json` — `correctness` + `suspicious` + `typeAware` + 逐条显式                          | `pnpm lint` 零错误                 |
| oxfmt      | `.oxfmtrc.json` — import 分组排序                                                                 | `pnpm format:check` 零差异         |
| pnpm       | `pnpm@11.3.0`, `node>=24`, `packageManager` 钉死                                                  | 不用 npm/yarn                      |

任何绕过（`// @ts-ignore`、`// oxlint-disable-next-line`、`/* prettier-ignore */`）必须附带一行注释说明**为什么这里非绕过不可**。无注释的绕过视为蓄意违规。

---

## 类型系统戒律

### 零 `any`

`any` 是瘟疫。项目里不应出现。如果 pi SDK 的类型定义确实返回 `any`，在消费点立即窄化——写到类型守卫、写到 assert 函数里，不要扩散到业务代码。

```ts
// ❌ 不合格：把 any 传染出去
const data: any = pi.session.get("state");
return data.money;

// ✅ 正确：在边界窄化
const raw = pi.session.get("state");
const state = assertStateSchema(raw);
return state.money;
```

### `as` 断言必须有理由

类型断言不是「我知道这是什么」的声明，是「编译器不知道，我来告诉它」的覆盖。每次 `as` 都是一次信任链断裂。

```ts
// ❌ 不合格：静默绕过
const el = document.getElementById("root") as HTMLDivElement;

// ✅ 合格：断言后立即验证，或注释说明为什么安全
const el = document.getElementById("root");
if (!el || !(el instanceof HTMLDivElement)) throw new Error("root not found");
// 或
const state = raw as State; // safe: validated by assertStateSchema above
```

### 导出函数必须标注返回类型

公共 API 的返回类型是契约的一部分。让编译器推导是让契约变成「碰巧产生的副作用」。

```ts
// ❌ 不合格
export function getStatus() {
  return status();
}

// ✅ 合格
export function getStatus(): StatusSnapshot {
  return status();
}
```

### 歧视联合 > optional 字段 > `| undefined`

一个状态对象有 N 种形态 → 用 tagged union，不要靠 optional 字段的存在性区分。

```ts
// ❌ 不合格
type SceneResult = {
  settlement?: Settlement; // 只有 success 才有
  events?: Event[];
  error?: string; // 只有 failure 才有
};

// ✅ 合格
type SceneResult =
  { kind: "success"; settlement: Settlement; events: Event[] } | { kind: "failure"; error: string };
```

---

## 文件与命名

### 文件按职责分目录，不按类型平铺

```
engine/                # 确定性运行时引擎
  core/                # state、scene、actor、servant、economy、memory、secret 等领域逻辑
  gm-prompt/           # prompt 组装、preset、render/injection 测试
  world-data/          # lookup 索引与世界数据读取

data/                  # 结构化世界数据、campaign preset、timeline contract

tools/                 # 工具定义与注册
  registry.ts          # pi tool schema/description/execute 注册
  state/               # 状态领域工具
  debug/               # debug/修档工具；常规玩法不得依赖
  lookup/              # 世界数据查询工具

agents/                # GM prompt 分层模块
skills/                # 玩家可调用技能，如 start-game
extensions/            # pi extension 动态注入、UI panel、subagent context
  subagents/
.pi/agents/            # 项目作用域子代理
scripts/               # 打包/发布脚本
```

### 文件名：kebab-case

```
core/state.ts     ✅
core/State.ts     ❌
core/stateStore.ts ❌（应拆成 state-store.ts）
```

### 变量/函数：camelCase。类型/接口：PascalCase。常量：UPPER_SNAKE_CASE

```ts
const INITIAL_STATE: GameState = { ... };
function adjustMoney(delta: number): void { ... }
type SceneParams = { ... };
```

### 带 `_` 前缀表示有意未使用

```ts
function handleTurn(state: State, _turnIndex: number): void {
  // _turnIndex 保留给未来使用，当前不需要
}
```

`noUnusedParameters` 已开启，不用 `_` 前缀的未用参数会直接编译失败。

---

## 导入纪律

### 零副作用导入

`import "./side-effects"` 不存在于本项目中。pi 用 jiti 加载、测试用 node 原生 type stripping 运行，模块初始化顺序不可靠。相对导入必须带 `.ts` 后缀（node 原生运行的硬性要求）。

### type import 必须显式

`verbatimModuleSyntax` 已开启。运行时用不到的东西必须标注 `type`：

```ts
import type { State, StatusSnapshot } from "./types";
import { patchState } from "./state";
```

### 导入分组顺序

oxfmt 已配置自动排序：`type-import` → `type-internal` → `type-parent/sibling/index` → `value-builtin/external` → `value-internal` → `value-parent/sibling/index`。不要手动排——跑 `pnpm format`。

---

## 错误处理

### 不吞错误

每个 `catch` 必须做点什么——throw、log、warp。空 `catch {}` 不存在。

```ts
// ❌ 不合格
try {
  doRisky();
} catch {}

// ✅ 合格：至少 log
try {
  doRisky();
} catch (e) {
  console.error("doRisky failed:", e);
  throw e;
}
```

### 抛有意义的错误

```ts
// ❌ 不合格
throw new Error("failed");

// ✅ 合格
throw new Error(`lookup("location", "${query}"): no match found`);
```

### 不要用异常做控制流

异常是异常。不要「try 一个操作，失败表示另一种状态」——用 discriminated union 表达两种可能性。

---

## 函数设计

### 单一职责，小函数

一个函数做一件事。函数体超过 30 行 → 开始怀疑它在做不止一件事。

### 纯函数优先

能不依赖外部状态的函数，就不依赖。纯函数可测试、可缓存、可复用。

```ts
// ❌ 不纯：依赖 global state store
function getBalance(): number {
  return globalThis.__idol_master_state_store__.money;
}

// ✅ 纯：传入 state
function getBalance(state: State): number {
  return state.money;
}
```

### 不写「可能以后有用」的抽象

YAGNI。只写当前需要的代码。多余的泛型参数、未调用的工厂函数、预留的扩展点——都是死后腐烂的尸体。

---

## 死代码零容忍

`noUnusedLocals` + `noUnusedParameters` 保证函数级干净。但还要注意：

- 未调用的导出函数 → 删
- 注释掉的代码 → 删（git 里有历史）
- 「先留着万一要用」的 `data/*.json` 字段 → 删
- 写了但没在 `tools/registry.ts` 注册的工具 → 删或注册

---

## 注释

### 注释解释「为什么」，不解释「是什么」

代码说「是什么」。如果代码说清楚了自己是什么，就不要注释。如果代码说不清楚——**先改代码**，后补注释。

```ts
// ❌ 不合格：复述代码
// increment money by delta
money += delta;

// ❌ 不合格：该改代码
// if status is 3 it means banned
if (user.status === 3) { ... }

// ✅ 合格：解释不可见的约束
// 必须用 adjustMoney 而非直接 patch——money 是 protected path，
// 裸 patch 会被 schema guard 拒绝
adjustMoney(delta);
```

### 不写 JSDoc 废话

```ts
// ❌ 不合格：复述签名
/** Get the current status */
export function getStatus(): StatusSnapshot { ... }
```

如果 JSDoc 只说了一遍类型签名已经写明的东西——删了它。

---

## 测试

### 确定性代码必测

state migration、schema validation、lookup 索引、场景结算公式——这些确定性逻辑必须有测试。测试跑在 `pnpm test` 里，CI 不可跳过。

### 不测 LLM 行为

GM 的叙事质量、工具调用的时机——这些不写测试。不是不想，是测不了。把测试资源集中在引擎逻辑上。

### 测试文件跟源文件同目录，或放 `tests/`

```
engine/core/state.test.ts   ✅
tests/state.test.ts         ✅
__tests__/state.ts          ❌（不用 jest 目录惯例）
```

### 测试的颗粒度

通常**仅在 commit 前才需要跑一次**，别在每个小改动中都测一次，没有意义。

---

## 提交

### 每 phase 完成后 commit & push

每完成一个独立可验收 phase，必须在四项检查通过后立即 commit 并 push。下一周期开始前工作区应保持干净，除非用户明确要求继续累积未提交改动。

### commit message 用英文 imperative

```
feat: add state rollback on session fork
fix: reject bare patch on protected money path
refactor: extract lookup index builder to shared utility
```

不要写「更新」「修」「改」这类无信息量的词。

### 提交前必须通过四项检查

```bash
pnpm format && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

一条不过 = 不能 commit。不允许 `--no-verify`。

---

## 反模式黑名单

以下模式在本项目中不存在，代码审查时看到即打回：

| 反模式 | 为什么禁止 |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------- | -------------- | --- | ----------------------------- |
| `Record<string, any>` | any 瘟疫的载体。定义具体类型 |
| `as unknown as T` | 双重断言等于放弃类型系统。写 type guard |
| `setTimeout` 做异步控制 | pi 的事件循环不受你控制。用 hook/工具返回值驱动 |
| mutation of function params | 纯函数不收副作用。clone 后改 |
| `!!` 做布尔转换 | 写 `Boolean(x)`——意图明确 |
| `x                           |                                                                                     | defaultValue` | 用 `??` 而非 `|     |`，除非你真的想捕获 `""`和`0` |
| 导出 mutable 对象 | `export const X = {}` 是全局可变状态。用函数包装 |
| magic number / magic string | 3.14 → `const TAX_RATE = 0.0314`。`"battle"` → `const SceneKind = { ... } as const` |
| 深层嵌套三元 | `a ? b ? c : d : e` → 用 if-else 或 lookup table |
| `import * as X` 命名空间导入 | 除非是 `import * as fs from "node:fs"` 这种标准库，否则具名导入 |
| 裸 JSON Patch 修正常规玩法 | 用领域工具；没有工具就新增窄领域事件 |
| 把 debug 工具当正常 GM 工具 | debug 只用于开发修档，正常剧情必须走领域工具 |

---

## 修改提示词 / 数据 / 引擎时的规则

- **改 GM prompt** → 保持模块分工：`gm-system.md` 只放身份与最高契约；世界边界在 `gm-context.md`；硬规则在 `gm-rules.md`；工具路由在 `gm-tool-policy.md`；剧情推进纪律在 `gm-story-driver.md`；渲染在 `gm-render.md`；输入解释在 `gm-input-guide.md`；输出格式在 `gm-output-contract.md`。不要把所有规则塞进 system 层。
- **改 `/skill:start-game`** → 它只处理新游戏/重新开始/创建角色。必须保持流程机、public/secrets/player knowledge 分层、protagonist 非凡者序列/途径秘密防泄露、新手模式。
- **新增工具** → 在 `tools/registry.ts` 注册；description 写成紧凑的「一行用途 + 使用边界 bullet + 禁区 bullet」，避免「必须调用场景/严禁行为」长清单这种 reasoning-bait。工具应是领域事件，不是状态栏 setter。不要在当前工具契约里提旧字段、旧 kind 或旧入口。
- **模型常犯错** → 先写回归测试或 JSONL 统计复现，再加工具拒绝/领域 invariant/schema 约束/迁移。不要只补 prompt。
- **改 state 结构** → bump `schemaVersion`，同步 initial state + schema + protected paths 白名单，新增逐版本 migration 和 migration 测试。只允许经 migration 后访问新字段，不做运行时 fallback。
- **查 state 的代码** → 必须处理 `noUncheckedIndexedAccess` 带来的 `| undefined`——每个索引访问都有判空路径。
- **改 lookup/data** → 保留 canonical fact skeleton，避免复制 wiki prose；不要引入非 LOTM 材料污染目标世界。
- **改 subagent** → project-scope、explicit `tools`、explicit `extensions`、bare JSON 输出约束必须保留。
- **改 release 包** → 跑打包检查，确认不含 `sessions/`、`state/`、`.pi/agent/`、`agents/user/`、`docs/`、`*.test.ts`。
- **任何改动** → `pnpm format && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` 全过。

---

## 项目结构

### 工具实际路径

工具路径是 `engine/tools/`。所有工具定义在 `engine/tools/registry.ts` 中集中注册。

### 目录结构速查

| 目录                | 职责                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| `engine/core/`      | 纯 domain 层：类型定义、schema、纯函数、state store                                 |
| `engine/tools/`     | LLM 工具层：包装 core 函数为 GM 可调用工具；`registry.ts` 统一注册                  |
| `engine/direction/` | 双 pass 接缝：direction packet schema、渲染器、散文史管理                           |
| `engine/gm-prompt/` | 提示词组装：拼接 agents/\*.md + 运行时状态                                          |
| `agents/`           | GM prompt 纯文本文件，被 engine/gm-prompt/ 读取                                     |
| `.pi/agents/`       | 项目子代理定义（novel-analyst, timeline-showrunner），与 agents/ 无关               |
| `extensions/`       | pi-coding-agent 扩展：面板、命令、渲染、回退、子代理                                |
| `data/`             | 静态世界数据：campaign presets (TS)、MD 设定文件 (运行时扫描)、JSON 配置 (僵尸数据) |
| `skills/`           | GM 可调用技能（如 start-game），与 `.agents/skills/` 是两回事                       |

### tools 开发指南

**新增工具步骤**：

1. 在 `engine/tools/<domain>/` 下新建文件，导出 `const xxxToolDefinition: DomainToolDefinition = { ... }`
2. 执行模式二选一：
   - **有状态变异**：使用 `runDomainEventTool({ sessionManager, execute, details, message })`
   - **纯计算**：直接 `textResult(text, details)`
3. 在 `engine/tools/registry.ts` 中 import 并加入 `TOOL_DEFINITIONS` 数组
4. `execute` 回调签名：`async (_toolCallId, params, _signal, _onUpdate, ctx)`

**三层参数处理**：

- Layer 1: `parameters` TypeBox schema（框架级结构声明）
- Layer 2: normalizer（参数归一化、字段名兼容）
- Layer 3: domain engine（严格解析 + 领域逻辑）

**description 编写**：必须包含使用边界（何时用）和禁区（何时不用）。参考 `roll_dice` 的简洁模式或 `commit_turn` 的详细模式。

### State Schema 现状

- `CURRENT_STATE_SCHEMA_VERSION = 0`（`engine/core/state/state.ts:606`，发布前已归零）
- 迁移链在 `engine/core/state/state-migration.ts`，线性版本迁移：每个函数负责 v*n → v*{n+1}
- 迁移入口在 `state-store.ts` 的 `assertState()`，在加载所有持久化状态前自动执行
- 新增/重命名字段时必须：
  1. 更新 `currentStateSchemaVersion` 版本号
  2. 在 `state-migration.ts` 添加对应的迁移函数并注册到 `migrateOneSchemaVersion` 路由
  3. 添加迁移测试

### 测试模式速查

| 模式               | 适用场景                                                                 | 典型文件                          |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------- |
| A: 纯函数测试      | createInitialState → 纯函数 → assert                                     | acting.test.ts, lotm-rank.test.ts |
| B: State mutation  | createInitialState → mutate draft → assert draft                         | economy.test.ts, secrets.test.ts  |
| C: 全局 store 测试 | resetState → getState/cloneState → assert                                | state-store.test.ts               |
| D: 工具集成测试    | resetState → noopSessionManager → 调函数 → assert state + result.content | commit-turn.test.ts               |
| E: Lint/审核测试   | 输入 prose → 验证规则是否命中                                            | lint-rules.test.ts                |
| F: 验证测试        | parseTypeBoxValue 边界情况                                               | typebox-validation.test.ts        |
| G: Session I/O     | JSONL 读写、分支裁剪                                                     | backstage-session-read.test.ts    |
| H: 跨平台/脚本     | spawn 进程验证启动                                                       | start-ps1.test.ts                 |

所有测试使用 `node:test` + `node:assert/strict`，无 mocking 框架，纯确定性逻辑。

### 诊断速查

**状态没写磁盘** → 检查是否走 `runDomainEventTool`，`sessionManager` 是否传入
**schema 报错** → 检查 state JSON 字段格式或引用断裂
**业务逻辑报错** → 检查 error message 中的实体 ID 和参数值

### 改代码前应先阅读的文件

1. `AGENTS.md`（本文件）— 工程纪律和项目概况
2. `.agents/skills/<对应领域>.md` — 项目专属技能，按场景触发
3. `engine/tools/registry.ts` — 了解已注册工具
4. `engine/core/state/state.ts` 和 `state-schema.ts` — 如果涉及状态变更
5. 对应 `engine/core/<domain>/` 的已有代码 — 了解现有实现模式

### 已定义但未注册的工具（注意勿误改）

以下 5 个工具在文件中有完整定义但未在 `registry.ts` 中注册：

- `roll_dice` (`engine/tools/lotm/roll-dice.ts`)
- `harvest_backstage_candidate` (`engine/tools/backstage/harvest-backstage-candidate.ts`)
- `manage_faction_clock` (`engine/tools/backstage/manage-faction-clock.ts`)
- `resolve_backstage_line` (`engine/tools/backstage/resolve-backstage-line.ts`)
- `run_parallel_line` (`engine/tools/backstage/run-parallel-line.ts`)

另有 `lookup/lookup.ts` 与 `lookup-rag.ts` 同名导出 `lookup`，但 registry 只用了 lookup-rag 的版本。

### 废弃/不参与运行的目录

##### _`data/config/_.json` — 部分已不参与运行\*

- **active** (被 engine/tools/lookup/ 运行时加载)：`神之途径.json`（sequence-lookup）、`economy-prices.json`（economy-lookup）
- **dead** (未被 engine 代码引用)：其余 17 个文件（序列基准、序列权重、地图数据、物品参数、产业配置等），但用户可能在其他地方手动使用
- 改 lookup 相关代码时注意不要误删 active 的 config 文件
- `agents/gm-rules - 副本.md` — 备份
