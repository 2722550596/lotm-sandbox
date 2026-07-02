/**
 * recall_memory 查询工具（backlog #6b）。
 *
 * 关键词/actor/地点/scope 过滤 campaign memory，返回匹配的
 * pinnedFacts + eventLog + dailySummaries。不上向量、不改状态。
 */

import type { DomainToolDefinition } from "../runtime/tool-definition.ts";
import type { ToolResult } from "../runtime/tool-result.ts";

import { Type } from "typebox";

import {
  recallMemory,
  type RecallMemoryQuery,
  type RecallMemoryResult,
} from "../../core/knowledge/memory-recall.ts";
import { hydrateStateFromSessionManager } from "../../core/state/session-persistence.ts";
import { getState } from "../../core/state/state-store.ts";
import { isRecord } from "../../core/utils/typebox-validation.ts";
import { textResult } from "../runtime/tool-result.ts";

export function recallMemoryTool(params: unknown, sessionManager: unknown): ToolResult {
  if (sessionManager !== undefined) {
    hydrateStateFromSessionManager(sessionManager);
  }
  const state = getState();
  const query = parseToolInput(params);
  const result = recallMemory(state, query);
  return textResult(formatRecallResult(result, query), { recallResult: result });
}

function parseToolInput(params: unknown): RecallMemoryQuery {
  if (!isRecord(params)) {
    throw new Error("recall_memory 参数必须是对象。");
  }
  return {
    keywords: optionalStringArray(params["keywords"]),
    actorId: optionalString(params["actorId"]),
    location: optionalString(params["location"]),
    scope: optionalString(params["scope"]),
    limit: optionalNumber(params["limit"]),
  };
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  return filtered.length > 0 ? filtered : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  return undefined;
}

function formatRecallResult(result: RecallMemoryResult, query: RecallMemoryQuery): string {
  const lines: string[] = [];
  const queryDesc = formatQueryDescription(query);
  lines.push(`记忆检索：${queryDesc}（${result.totalMatches} 条匹配）`);
  lines.push("");

  if (result.pinnedFacts.length > 0) {
    lines.push("【钉住事实】");
    for (const fact of result.pinnedFacts) {
      lines.push(`  [${fact.scope}] ${fact.subject}：${fact.text}（since ${fact.since}）`);
    }
    lines.push("");
  }

  if (result.events.length > 0) {
    lines.push("【重大事件】");
    for (const event of result.events) {
      const consequences =
        event.consequences.length > 0 ? ` → ${event.consequences.join("；")}` : "";
      lines.push(`  ${event.title}：${event.summary}${consequences}（${event.time}）`);
    }
    lines.push("");
  }

  if (result.dailySummaries.length > 0) {
    lines.push("【每日总结】");
    for (const summary of result.dailySummaries) {
      lines.push(`  ${summary.startDate}～${summary.endDate}：${summary.summary}`);
    }
    lines.push("");
  }

  if (result.dailyEvents.length > 0) {
    lines.push("【日常事件】");
    for (const event of result.dailyEvents) {
      lines.push(`  [${event.eventKind}] ${event.title}：${event.summary}（${event.time}）`);
    }
    lines.push("");
  }

  if (result.totalMatches === 0) {
    lines.push("未找到匹配的记忆。");
  }

  return lines.join("\n").trimEnd();
}

function formatQueryDescription(query: RecallMemoryQuery): string {
  const parts: string[] = [];
  if (query.keywords !== undefined && query.keywords.length > 0) {
    parts.push(`关键词=[${query.keywords.join(", ")}]`);
  }
  if (query.actorId !== undefined) {
    parts.push(`actor=${query.actorId}`);
  }
  if (query.location !== undefined) {
    parts.push(`地点=${query.location}`);
  }
  if (query.scope !== undefined) {
    parts.push(`scope=${query.scope}`);
  }
  return parts.length > 0 ? parts.join(", ") : "全量";
}

export const recallMemoryToolDefinition: DomainToolDefinition = {
  name: "recall_memory",
  description:
    "检索 scenario memory（pinnedFacts + eventLog + dailyEvents + dailySummaries）。按关键词/actor/地点/scope 过滤，返回匹配条目。不改状态。\n\n" +
    "【使用边界】\n" +
    "- 需回忆旧事实但 GM brief 只有最近 3 条 eventLog\n" +
    "- 玩家提到过去事件/人/地，需确认记忆一致性\n" +
    "- 写对话/内心前需确认某 NPC/地点已记录事实\n" +
    "- compaction 后恢复上下文\n\n" +
    "【不需调用】\n" +
    "- 最近 2-3 轮刚记的事件（brief 已注入）\n" +
    "- 纯创作性描写",
  parameters: Type.Object({
    keywords: Type.Optional(
      Type.Array(Type.String(), { description: "关键词列表（OR 匹配，中英文均可）" }),
    ),
    actorId: Type.Optional(Type.String({ description: "按 actorId 过滤" })),
    location: Type.Optional(Type.String({ description: "按地点关键词过滤" })),
    scope: Type.Optional(
      Type.String({ description: "按 scope 过滤（character/world/faction/relationship）" }),
    ),
    limit: Type.Optional(Type.Number({ description: "最多返回条数（默认 8，上限 20）" })),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    recallMemoryTool(params, ctx.sessionManager),
};
