import type { DomainToolDefinition } from "../runtime/tool-definition.ts";

import { Type } from "typebox";

import { persistStateAfterCommit } from "../../core/state/session-persistence.ts";
import { cloneState, commitState } from "../../core/state/state-store.ts";
import { textResult, type ToolResult } from "../runtime/tool-result.ts";

export function clearBackstageLockTool(params: unknown, sessionManager: unknown): ToolResult {
  const raw = params;
  const runId =
    typeof raw === "object" && raw !== null && "runId" in raw
      ? (raw as Record<string, unknown>)["runId"]
      : undefined;
  const specificRunId = typeof runId === "string" && runId.length > 0 ? runId : undefined;

  const draft = cloneState();
  const cleared: string[] = [];

  if (specificRunId !== undefined) {
    // Clear only the specified run
    const before = draft.secrets.backstagePendingHarvests.length;
    draft.secrets.backstagePendingHarvests = draft.secrets.backstagePendingHarvests.filter(
      (entry) => entry.runId !== specificRunId,
    );
    const removed = before - draft.secrets.backstagePendingHarvests.length;
    if (removed > 0) {
      cleared.push(`pending-run:${specificRunId}`);
    }
  } else {
    // Clear all pending harvests
    const count = draft.secrets.backstagePendingHarvests.length;
    if (count > 0) {
      draft.secrets.backstagePendingHarvests = [];
      cleared.push(`pending-harvests(${count})`);
    }
  }

  // Always clear backstage obligations (stale from dead session)
  const oblCount = draft.secrets.backstageObligations.length;
  if (oblCount > 0) {
    draft.secrets.backstageObligations = [];
    cleared.push(`obligations(${oblCount})`);
  }

  // Reset the no-cost streak so a fresh session isn't penalized
  if (draft.secrets.backstagePressure.consecutiveNoCostTurns > 0) {
    draft.secrets.backstagePressure.consecutiveNoCostTurns = 0;
    cleared.push("pressure-counter");
  }

  commitState(draft);
  persistStateAfterCommit(sessionManager, { cleared });

  if (cleared.length === 0) {
    return textResult("没有需要清理的 backstage 锁。backstage 状态干净。", { cleared: [] });
  }

  return textResult(`已清理 backstage 锁：${cleared.join(", ")}。`, { cleared });
}

export const clearBackstageLockToolDefinition: DomainToolDefinition = {
  name: "clear_backstage_lock",
  description:
    "【调试工具】清理卡档的 backstage 锁。用于 session 切换后残留的 pending-harvest 标记导致 GM 无法 commit 或 resolve。\n\n" +
    "使用边界：\n" +
    "- 不传 runId 时清空全部 pending harvest + backstage obligations + pressure 计数器\n" +
    "- 传 runId 时只清理该 run 的 pending 标记（仍清全部 obligations）\n\n" +
    "禁区：\n" +
    "- 正常流程不应使用——正确路径是 harvest_backstage_candidate → manage_undercurrent/resolve_backstage_line\n" +
    "- 清理后原 run 的候选无法再从 engine 侧取回；如果仍有必要，手动读 session 文件\n" +
    "- 只清锁不恢复 state；需要回滚之前 commit_turn 的副作用时请用其他 debug 工具",
  parameters: Type.Object({
    runId: Type.Optional(
      Type.String({
        description: "可选：只清理指定 runId 的 pending 标记；省略则清空全部 pending",
      }),
    ),
  }),
  execute: async (
    _toolCallId: string,
    params: unknown,
    _signal: AbortSignal,
    _onUpdate: unknown,
    ctx: { sessionManager: unknown },
  ) => clearBackstageLockTool(params, ctx.sessionManager),
};
