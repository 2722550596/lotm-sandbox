/**
 * 主 GM 进程侧的 timeline 子代理上下文注入。
 *
 * canonical state 只活在主进程内存 + session entries 里；子代理是独立 pi 进程，
 * 看不到这两者。旧方案让子代理 extension 去读 state/state.json 侧通道，
 * 会拿到陈旧/被测试砸坏/属于别的 session 的快照。新方案：主进程在 subagent
 * 工具调用发出前（tool_call 事件的 event.input 官方可变），把调用瞬间的
 * 子代理安全投影直接改写进 task 参数，零文件、零 env、secrets 过滤留在父侧。
 */

import { buildTimelineStateContextFromRaw } from "../../engine/core/state/state-file-projection.ts";
import { isRecord } from "../../engine/core/utils/typebox-validation.ts";

/**
 * 需要注入 <timeline_state_context> 的 project-scope 子代理名（不含 package 前缀）。
 * parallel-line 已迁到引擎直接异步后台底座（不再走同步子代理，上下文由
 * engine 的 buildBackstageDirectorPrompt 直接拼进 prompt）；仅 timeline-showrunner
 * 仍用同步子代理 + 这里的就地注入。
 */
const TIMELINE_CONTEXT_AGENTS = new Set(["timeline-showrunner"]);

const CONTEXT_OPEN_TAG = "<timeline_state_context>";

/** chain 步骤省略 task 时 pi-subagents 默认用 {previous}，注入时必须保住该语义。 */
const CHAIN_DEFAULT_TASK = "{previous}";

export function buildTimelineStateContextBlock(rawState: unknown): string {
  const context = buildTimelineStateContextFromRaw(rawState);
  return [
    CONTEXT_OPEN_TAG,
    "以下是当前 canonical state 的子代理安全摘要，由主 GM 进程在调用瞬间注入；不要要求主 GM 重复提供，也不要把本段原样写给玩家。",
    "检查 undercurrents 中的暗流状态，避免重复的 actor/pressureType；如果最近已连续使用同一压力类型，优先换成其它方向或返回 no-change/blocked。",
    "actor.agenda / actor.knowledgeLens 是 NPC 主动性与认知边界账本；relationshipSignals 是关系行为证据账本；可用于判断 NPC 自主行动和关系代价，但不得把 hidden knowledge 或 secret signals 原样写成玩家可见文本。",
    "所有输出 timeRange.start/end 必须是 ISO UTC 字符串；displayTime 只是本地展示时间，不得把本地时钟当 UTC。timeRange.end 不得晚于 currentAt。",
    JSON.stringify(context, null, 2),
    "</timeline_state_context>",
  ].join("\n");
}

/**
 * 就地改写 subagent 工具调用参数，给所有 timeline 子代理的 task 追加上下文块。
 * 覆盖三种执行形态：SINGLE（agent/task）、PARALLEL（tasks[]）、CHAIN
 * （chain[] 的顺序步骤、静态 parallel 数组、expand/collect 的动态 parallel 模板）。
 * 返回注入条数；已含上下文块的 task 跳过，保证幂等。
 */
export function injectTimelineContextIntoSubagentInput(
  input: Record<string, unknown>,
  contextBlock: string,
): number {
  let injected = 0;
  if (isTimelineAgent(input["agent"])) {
    injected += injectIntoTaskHolder(input, contextBlock, "");
  }
  injected += injectIntoTaskEntries(input["tasks"], contextBlock, "");
  const chain = input["chain"];
  if (Array.isArray(chain)) {
    for (const step of chain) {
      if (!isRecord(step)) {
        continue;
      }
      if (isTimelineAgent(step["agent"])) {
        injected += injectIntoTaskHolder(step, contextBlock, CHAIN_DEFAULT_TASK);
      }
      const parallel = step["parallel"];
      if (Array.isArray(parallel)) {
        injected += injectIntoTaskEntries(parallel, contextBlock, CHAIN_DEFAULT_TASK);
      } else if (isRecord(parallel) && isTimelineAgent(parallel["agent"])) {
        injected += injectIntoTaskHolder(parallel, contextBlock, CHAIN_DEFAULT_TASK);
      }
    }
  }
  return injected;
}

function injectIntoTaskEntries(
  value: unknown,
  contextBlock: string,
  missingTaskBase: string,
): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  let injected = 0;
  for (const entry of value) {
    if (isRecord(entry) && isTimelineAgent(entry["agent"])) {
      injected += injectIntoTaskHolder(entry, contextBlock, missingTaskBase);
    }
  }
  return injected;
}

function injectIntoTaskHolder(
  holder: Record<string, unknown>,
  contextBlock: string,
  missingTaskBase: string,
): number {
  const task = holder["task"];
  if (typeof task === "string" && task.includes(CONTEXT_OPEN_TAG)) {
    return 0;
  }
  const base = typeof task === "string" && task.trim() !== "" ? task : missingTaskBase;
  holder["task"] = base === "" ? contextBlock : `${base}\n\n${contextBlock}`;
  return 1;
}

function isTimelineAgent(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const dotIndex = value.lastIndexOf(".");
  const bareName = dotIndex === -1 ? value : value.slice(dotIndex + 1);
  return TIMELINE_CONTEXT_AGENTS.has(bareName);
}
