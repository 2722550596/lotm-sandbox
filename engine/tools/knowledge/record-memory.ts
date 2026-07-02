import type { MemoryEvent, MemoryEventResult } from "../../core/knowledge/memory.ts";
import type { DomainToolDefinition } from "../runtime/tool-definition.ts";
import type { ToolResult } from "../runtime/tool-result.ts";

import { Type } from "typebox";

import { parseMemoryEvent } from "../../core/knowledge/memory-schema.ts";
import { recordMemory } from "../../core/knowledge/memory.ts";
import { isRecord } from "../../core/utils/typebox-validation.ts";
import { runDomainEventTool } from "../system/domain-tool-runner.ts";

export function recordMemoryTool(params: unknown, sessionManager: unknown): ToolResult {
  return runDomainEventTool({
    sessionManager,
    execute: (draft) => {
      const event = parseMemoryEvent(normalizeSourceEventId(params), "record_memory 参数");
      return { event, result: recordMemory(draft, event) };
    },
    details: ({ result }) => ({ result }),
    message: ({ event, result }) => formatResult(event, result),
  });
}

function formatResult(params: MemoryEvent, result: MemoryEventResult): string {
  switch (params.kind) {
    case "pin-fact":
      return `长期事实已记录：${result.factId ?? "?"}\n- ${params.text}`;
    case "record-major-event":
      return `重大事件已记录：${result.eventId ?? "?"}\n- ${params.title}: ${params.summary}`;
    case "record-daily-summary":
      return `日常摘要已记录：${result.dailySummaryId ?? "?"}\n- ${params.summary}`;
    case "record-daily-event":
      return `日常事件已记录：${result.dailyEventId ?? "?"}\n- [${params.eventKind}] ${params.title}: ${params.summary}`;
    default:
      return "未知记忆事件类型。";
  }
}

/** pin-fact 的 sourceEventId 容错：缺失/空白一律归一为 null——领域归一化，不是校验。 */
function normalizeSourceEventId(params: unknown): unknown {
  if (!isRecord(params) || params["kind"] !== "pin-fact") {
    return params;
  }
  const raw = params["sourceEventId"];
  const sourceEventId = typeof raw === "string" && raw.trim().length > 0 ? raw : null;
  return { ...params, sourceEventId };
}

export const recordMemoryToolDefinition: DomainToolDefinition = {
  name: "record_memory",
  description:
    "写入玩家已知的记忆。重大变化用 record-major-event + claims（非 mundane 类 claim 必须提供证据或 secret 关联）；单项日常记录用 record-daily-event；日终摘要用 record-daily-summary；长期事实钉用 pin-fact。\n\n" +
    "【使用边界】\n" +
    "- 重大变化（晋升/契约/战斗结论/阵营/永久缺损等可信度很重要的事件）：record-major-event + claims\n" +
    "- 单项日常事件（采购/会面/移动/观察/关系互动等不需要审计的笔记）：record-daily-event + eventKind 分类\n" +
    "- 半天以上跳过、日终/章节摘要：record-daily-summary\n" +
    "- 离散事实钉（玩家身份/已知盟友名单等长期稳定事实）：pin-fact\n\n" +
    "禁区：\n" +
    "- 记 GM 猜测、幕后真相、闲聊或短暂情绪\n" +
    "- 把玩家未确认秘密写进 public memory\n" +
    "- 非 mundane claim 缺 evidence/relatedSecretSlotIds 却标 confirmed/observed/inferred\n" +
    "- 用 record-daily-summary 或 record-daily-event 绕过 claims 记重大事件",
  parameters: Type.Object({
    kind: Type.String({
      description:
        "允许: pin-fact / record-major-event / record-daily-event / record-daily-summary",
    }),
    scope: Type.Optional(
      Type.String({ description: "可选范围，允许: protagonist / npc / faction / world" }),
    ),
    subject: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    sourceEventId: Type.Optional(Type.String()),
    claims: Type.Array(
      Type.Object({
        kind: Type.String({
          description:
            "claim 类型（仅 record-major-event 使用）。mundane=普通事实（legacy 兼容，建议日常记录用 record-daily-event）。非 mundane（identity/location/affiliation/motive/ability/resource/relationship/event-cause/world-fact）如果标 confirmed/observed/inferred，必须提供 evidence 或关联已揭示的 secret（relatedSecretSlotIds）",
        }),
        statement: Type.String({
          description: "事实陈述，如「克莱恩能逆走四步上灰雾」",
        }),
        certainty: Type.String({
          description:
            "证据确信度。observed=亲眼所见、confirmed=已确认、inferred=推理得出、rumor=传闻、hypothesis=假设。非 mundane claim 用 rumor/hypothesis 时不需要 evidence/secret 关联，但措辞必须不确定",
        }),
        subjectId: Type.Optional(Type.String()),
        relatedSecretSlotIds: Type.Optional(
          Type.Array(
            Type.String({
              description:
                "关联已揭示的 secret slot id。如果这个 claim 基于某个已揭示的秘密（如角色的非凡途径），填对应的 secret slot id。前提是该 secret 已被 reveal_secret 揭示过",
            }),
          ),
        ),
        evidence: Type.Optional(
          Type.String({
            description:
              '非 mundane claim 标 confirmed/observed/inferred 时的证据描述。可以是角色的行动记录、NPC 的证词、角色的观察等可直接审计的来源。例如："克莱恩在灰雾之上观察罗塞尔笔记时确认了这一点"',
          }),
        ),
      }),
    ),
    eventKind: Type.Optional(
      Type.String({
        description:
          "record-daily-event 必填：日常事件类型。允许: mundane / relationship / location / shopping / meeting / travel / observation",
      }),
    ),
    title: Type.Optional(
      Type.String({
        description: "record-major-event / record-daily-event 必填：事件标题",
      }),
    ),
    summary: Type.Optional(
      Type.String({
        description:
          "record-major-event / record-daily-event / record-daily-summary 必填：事件描述",
      }),
    ),
    consequences: Type.Optional(Type.Array(Type.String())),
    startDate: Type.Optional(
      Type.String({
        description:
          "record-daily-summary 必填：摘要起始。接受相对偏移（-4hours/-1day）或 ISO 字符串",
      }),
    ),
    endDate: Type.Optional(
      Type.String({
        description: "record-daily-summary 必填：摘要结束。接受相对偏移（-30min/+0）或 ISO 字符串",
      }),
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    recordMemoryTool(params, ctx.sessionManager),
};
