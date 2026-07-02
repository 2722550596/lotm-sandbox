import type { TurnObligationKind } from "../../core/state/state.ts";
import type { DomainToolDefinition } from "../runtime/tool-definition.ts";

import { Type } from "typebox";

import { OBLIGATION_KIND_GUIDANCE } from "../../core/ledger/obligations.ts";
import { persistStateAfterCommit } from "../../core/state/session-persistence.ts";
import { cloneState, commitState } from "../../core/state/state-store.ts";
import { textResult, type ToolResult } from "../runtime/tool-result.ts";

const OBLIGATION_KINDS = Object.freeze(Object.keys(OBLIGATION_KIND_GUIDANCE));

function isObligationKind(value: string): value is TurnObligationKind {
  return Object.prototype.hasOwnProperty.call(OBLIGATION_KIND_GUIDANCE, value);
}

export function clearObligationTool(params: unknown, sessionManager: unknown): ToolResult {
  const raw = params;
  const obligationId =
    typeof raw === "object" && raw !== null && "obligationId" in raw
      ? (raw as Record<string, unknown>)["obligationId"]
      : undefined;
  const rawKind =
    typeof raw === "object" && raw !== null && "kind" in raw
      ? (raw as Record<string, unknown>)["kind"]
      : undefined;

  const specificId =
    typeof obligationId === "string" && obligationId.length > 0 ? obligationId : undefined;
  const specificKind =
    typeof rawKind === "string" && isObligationKind(rawKind) ? rawKind : undefined;

  const draft = cloneState();
  const before = draft.public.obligations.length;
  const cleared: Array<{ id: string; kind: string; summary: string }> = [];

  if (specificId !== undefined) {
    const index = draft.public.obligations.findIndex((entry) => entry.id === specificId);
    if (index !== -1) {
      const [removed] = draft.public.obligations.splice(index, 1);
      if (removed !== undefined) {
        cleared.push({ id: removed.id, kind: removed.kind, summary: removed.summary });
      }
    }
  } else if (specificKind !== undefined) {
    const removed = draft.public.obligations.filter((entry) => entry.kind === specificKind);
    draft.public.obligations = draft.public.obligations.filter(
      (entry) => entry.kind !== specificKind,
    );
    for (const entry of removed) {
      cleared.push({ id: entry.id, kind: entry.kind, summary: entry.summary });
    }
  } else {
    for (const entry of draft.public.obligations) {
      cleared.push({ id: entry.id, kind: entry.kind, summary: entry.summary });
    }
    draft.public.obligations = [];
  }

  commitState(draft);
  persistStateAfterCommit(sessionManager, { cleared });

  if (cleared.length === 0) {
    const hint =
      specificId !== undefined
        ? `未找到 obligation ${specificId}。`
        : specificKind !== undefined
          ? `没有 kind=${specificKind} 的义务。`
          : "没有待清理的义务。";
    return textResult(`${hint} 当前义务：${before} 条。`, { cleared: [] });
  }

  const lines = [`已清理 ${cleared.length} 条裁决义务（原来 ${before} 条）：`];
  for (const entry of cleared) {
    lines.push(`  - [${entry.kind}] ${entry.id}: ${entry.summary}`);
  }
  return textResult(lines.join("\n"), { cleared });
}

export const clearObligationToolDefinition: DomainToolDefinition = {
  name: "clear_obligation",
  description:
    "【调试工具】清除 public.obligations 中的裁决义务。用于 resolve_combat_exchange 后 obligations 卡档的死锁恢复。\n\n" +
    "使用边界：\n" +
    "- 不传参数时清空全部 obligations\n" +
    "- 传 obligationId 时只清除指定 id 的单项\n" +
    "- 传 kind 时只清除指定类型的所有 obligations\n\n" +
    "可用的 kind：" +
    OBLIGATION_KINDS.join(" / ") +
    "\n\n" +
    "禁区：\n" +
    "- 正常流程不应使用——正确路径是通过 commit_turn 落地义务\n" +
    "- 清 obligation 不回滚对应的 state 副作用；清理前确认对应领域事件是否需要补齐",
  parameters: Type.Object({
    obligationId: Type.Optional(
      Type.String({
        description: "可选：只清除指定 id 的单项 obligation",
      }),
    ),
    kind: Type.Optional(
      Type.String({
        description: "可选：只清除指定 kind 的全部 obligations。与 obligationId 互斥",
      }),
    ),
  }),
  execute: async (
    _toolCallId: string,
    params: unknown,
    _signal: AbortSignal,
    _onUpdate: unknown,
    ctx: { sessionManager: unknown },
  ) => clearObligationTool(params, ctx.sessionManager),
};
