import type { DomainToolDefinition } from "../runtime/tool-definition.ts";
import type { ToolResult } from "../runtime/tool-result.ts";

import { Temporal } from "@js-temporal/polyfill";
import { Type } from "typebox";

import { persistStateAfterCommit } from "../../core/state/session-persistence.ts";
import { cloneState, commitState } from "../../core/state/state-store.ts";
import { isRecord } from "../../core/utils/typebox-validation.ts";
import { textResult } from "../runtime/tool-result.ts";

export function adjustClockTool(params: unknown, sessionManager: unknown): ToolResult {
  const targetTime = assertValidIsoString(params);
  const reason = assertReason(params);

  const draft = cloneState();
  const before = draft.public.clock.currentAt;
  draft.public.clock.currentAt = targetTime;
  commitState(draft);

  const details: Record<string, unknown> = { before, after: targetTime, reason };
  persistStateAfterCommit(sessionManager, details);
  return textResult(`内部时钟已调整：${before} → ${targetTime}（${reason}）`, details);
}

function assertValidIsoString(params: unknown): string {
  if (!isRecord(params)) {
    throw new Error("adjust_clock 参数必须包含 targetTime（ISO 8601 字符串）");
  }
  const raw = params["targetTime"];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("adjust_clock.targetTime 必须是非空字符串");
  }
  // Validate parseable as Temporal.Instant
  try {
    Temporal.Instant.from(raw);
  } catch {
    throw new Error(
      `adjust_clock.targetTime 不是合法的 ISO 8601 时间字符串：${raw}。格式示例：2004-02-01T14:00:00.000Z`,
    );
  }
  return raw;
}

function assertReason(params: unknown): string {
  if (!isRecord(params)) {
    throw new Error("adjust_clock.reason 必须是非空字符串");
  }
  const raw = params["reason"];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("adjust_clock.reason 必须是非空字符串");
  }
  return raw;
}

export const adjustClockToolDefinition: DomainToolDefinition = {
  name: "adjust_clock",
  description:
    "【调试工具】手动调整游戏内部时钟。\n\n" +
    "游戏时钟与叙事时间脱节时使用（如机械时间停留在周四，但叙事已推进至周六），" +
    "把时钟对齐到叙事当前时间点。\n\n" +
    "使用边界：\n" +
    "- 时钟落后于叙事进度，导致 manage_undercurrent 报错「未来事件」\n" +
    "- 多轮 elapsedMinutes 累积误差超过了半小时\n" +
    "- 发现上一轮的 elapsedMinutes 填错了\n\n" +
    "禁区：\n" +
    "- 正常流程应通过 elapsedMinutes 推进时钟，adjust_clock 是事后补救\n" +
    "- 不要用来把时钟调回过去（回滚请用其他 debug 工具）\n" +
    "- 调完时钟后注意同步 scene.lastResolvedAt（如有必要）",
  parameters: Type.Object({
    targetTime: Type.String({
      description: "目标时钟时间，ISO 8601 格式，如 2004-02-01T14:00:00.000Z。应等于叙事当前时间",
    }),
    reason: Type.String({ description: "为什么需要调整时钟？和叙事时间差了多少？" }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    adjustClockTool(params, ctx.sessionManager),
};
