import type { State } from "../../core/state/state.ts";
import type { DomainToolDefinition } from "../runtime/tool-definition.ts";
import type { ToolResult } from "../runtime/tool-result.ts";

import { Type } from "typebox";
import { Compile } from "typebox/compile";

import {
  settleOldestBackstageObligation,
  resetBackstagePressure,
} from "../../core/backstage/backstage-obligation.ts";
import { clearPendingHarvestByLine } from "../../core/backstage/backstage-pending.ts";
import {
  brewUndercurrent,
  advanceUndercurrent,
  manifestUndercurrent,
  disruptUndercurrent,
  subsideUndercurrent,
  scheduleEvent,
  resolveScheduledEvent,
  extendScheduledEvent,
} from "../../core/backstage/undercurrent.ts";
import { stringEnumSchema } from "../../core/state/state-enum-schemas.ts";
import { UNDERCURRENT_VISIBILITIES } from "../../core/state/state-schema.ts";
import {
  assertNonEmptyString,
  isRecord,
  parseTypeBoxValue,
} from "../../core/utils/typebox-validation.ts";
import { runDomainEventTool } from "../system/domain-tool-runner.ts";

const MANAGE_UNDERCURRENT_KINDS = [
  "brew",
  "advance",
  "manifest",
  "disrupt",
  "subside",
  "schedule-event",
  "resolve-due",
  "extend-due",
] as const;

export function manageUndercurrentTool(params: unknown, sessionManager: unknown): ToolResult {
  return runDomainEventTool({
    sessionManager,
    execute: (draft) => executeManageUndercurrent(draft, params),
    details: (message) => ({ message }),
    message: (message) => message,
  });
}

function executeManageUndercurrent(draft: State, params: unknown): string {
  if (!isRecord(params)) {
    throw new Error("manage_undercurrent 参数必须是对象。");
  }
  const kind = assertNonEmptyString(params["kind"], "kind");
  switch (kind) {
    case "brew": {
      const input = parseTypeBoxValue(params, "brew 参数", BREW_VALIDATOR);
      const uc = brewUndercurrent(draft, input);
      settleOldestBackstageObligation(draft, {
        outcome: "landed",
        reasonCode: "undercurrent-brew",
        note: `潜流已酿造：${uc.id}`,
      });
      clearPendingHarvestByLine(draft, "");
      resetBackstagePressure(draft);
      return `潜流已酿造：${uc.id}｜${uc.label}（${uc.filled}/${uc.size}，${uc.visibility}）。`;
    }
    case "advance": {
      const input = parseTypeBoxValue(params, "advance 参数", ADVANCE_VALIDATOR);
      const { clock, becameFull } = advanceUndercurrent(
        draft,
        input.undercurrentId,
        input.ticks,
        input.reason,
      );
      settleOldestBackstageObligation(draft, {
        outcome: "landed",
        reasonCode: "undercurrent-advance",
        note: `潜流已推进：${clock.id}`,
      });
      clearPendingHarvestByLine(draft, "");
      resetBackstagePressure(draft);
      return becameFull
        ? `潜流已填满：${clock.id}｜${clock.label}（${clock.filled}/${clock.size}）。必须 manifest 或 disrupt 处理。`
        : `潜流已推进：${clock.id}｜${clock.label}（${clock.filled}/${clock.size}）。`;
    }
    case "manifest": {
      const input = parseTypeBoxValue(params, "manifest 参数", MANIFEST_VALIDATOR);
      const uc = manifestUndercurrent(draft, input.undercurrentId, input.summary);
      return `潜流已显现：${uc.id}｜${uc.label}。格局变化已记入幕后事件日志。`;
    }
    case "disrupt": {
      const input = parseTypeBoxValue(params, "disrupt 参数", DISRUPT_VALIDATOR);
      const uc = disruptUndercurrent(draft, input.undercurrentId, input.reason);
      return `潜流已被扰乱：${uc.id}｜${uc.label}。`;
    }
    case "subside": {
      const input = parseTypeBoxValue(params, "subside 参数", SUBSIDE_VALIDATOR);
      const uc = subsideUndercurrent(draft, input.undercurrentId, input.reason);
      return `潜流已平息：${uc.id}｜${uc.label}。`;
    }
    case "schedule-event": {
      const input = parseTypeBoxValue(params, "schedule-event 参数", SCHEDULE_EVENT_VALIDATOR);
      const event = scheduleEvent(draft, input.dueAt, input.summary);
      return `到期义务已登记：${event.id}（${event.dueAt}）${event.summary}`;
    }
    case "resolve-due": {
      const input = parseTypeBoxValue(params, "resolve-due 参数", RESOLVE_DUE_VALIDATOR);
      const event = resolveScheduledEvent(draft, input.eventId, input.outcomeSummary);
      return `到期义务已兑现并移除：${event.id}。结果已记入幕后事件日志。`;
    }
    case "extend-due": {
      const input = parseTypeBoxValue(params, "extend-due 参数", EXTEND_DUE_VALIDATOR);
      const event = extendScheduledEvent(draft, input.eventId, input.newDueAt, input.reason);
      return `到期义务已展期：${event.id} → ${event.dueAt}。`;
    }
    default:
      throw new Error(`不支持的 kind: ${kind}。允许: ${MANAGE_UNDERCURRENT_KINDS.join(" / ")}。`);
  }
}

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

const BREW_SCHEMA = Type.Object({
  kind: Type.Literal("brew"),
  actorIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  label: Type.String({ minLength: 1 }),
  size: Type.Integer({ minimum: 2, maximum: 12 }),
  visibility: stringEnumSchema(UNDERCURRENT_VISIBILITIES),
  pressureType: Type.String({ minLength: 1 }),
  futureHook: Type.String({ minLength: 1 }),
});

const ADVANCE_SCHEMA = Type.Object({
  kind: Type.Literal("advance"),
  undercurrentId: Type.String({ minLength: 1 }),
  ticks: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1 }),
});

const MANIFEST_SCHEMA = Type.Object({
  kind: Type.Literal("manifest"),
  undercurrentId: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
});

const DISRUPT_SCHEMA = Type.Object({
  kind: Type.Literal("disrupt"),
  undercurrentId: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1 }),
});

const SUBSIDE_SCHEMA = Type.Object({
  kind: Type.Literal("subside"),
  undercurrentId: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1 }),
});

const SCHEDULE_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("schedule-event"),
  dueAt: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
});

const RESOLVE_DUE_SCHEMA = Type.Object({
  kind: Type.Literal("resolve-due"),
  eventId: Type.String({ minLength: 1 }),
  outcomeSummary: Type.String({ minLength: 1 }),
});

const EXTEND_DUE_SCHEMA = Type.Object({
  kind: Type.Literal("extend-due"),
  eventId: Type.String({ minLength: 1 }),
  newDueAt: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1 }),
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const BREW_VALIDATOR = Compile(BREW_SCHEMA);
const ADVANCE_VALIDATOR = Compile(ADVANCE_SCHEMA);
const MANIFEST_VALIDATOR = Compile(MANIFEST_SCHEMA);
const DISRUPT_VALIDATOR = Compile(DISRUPT_SCHEMA);
const SUBSIDE_VALIDATOR = Compile(SUBSIDE_SCHEMA);
const SCHEDULE_EVENT_VALIDATOR = Compile(SCHEDULE_EVENT_SCHEMA);
const RESOLVE_DUE_VALIDATOR = Compile(RESOLVE_DUE_SCHEMA);
const EXTEND_DUE_VALIDATOR = Compile(EXTEND_DUE_SCHEMA);

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const manageUndercurrentToolDefinition: DomainToolDefinition = {
  name: "manage_undercurrent",
  description:
    "管理幕后潜流和预定的到期事件。\n\n潜流是 GM 视角中正在暗中酝酿的势力动向——就像棋盘上玩家还没看到的暗子。它们有进度、参与者、可见度和压力类型。潜流填满时必须 manifest（显现为格局变化）或 disrupt（被打乱）。到期事件则是必然会发生的预定节点。\n\n【各操作说明】\n- brew：酿造一条新的潜流，设定参与者、大小、可见度和压力类型\n- advance：推进潜流进度（比如阴谋又深入了一步）\n- manifest：潜流填满后显现为具体的格局变化并移除潜流\n- disrupt：潜流被打乱或偏离了方向，记录原因并移除\n- subside：潜流自然消退、不再活跃，记录原因后移除\n- schedule-event：预定一个未来必然发生的事件（比如「3 天后神秘聚会」）\n- resolve-due：到期事件发生了，记录结果并移除\n- extend-due：到期事件还没准备好触发，延期到更晚\n\n【不要这样做】\n- 把潜流内容或到期事件直接写进玩家可见的正文里\n- 没有合理依据就推进潜流\n- 用 extend-due 无限拖延同一件事\n- 潜流填满后不处理（必须 manifest 或 disrupt）",
  parameters: Type.Object({
    kind: Type.String({
      description:
        "brew / advance / manifest / disrupt / subside / schedule-event / resolve-due / extend-due",
    }),
    actorIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "brew 必填：涉及的参与者 actor ID 列表",
      }),
    ),
    undercurrentId: Type.Optional(
      Type.String({
        description: "advance/manifest/disrupt/subside 必填：潜流 ID",
      }),
    ),
    label: Type.Optional(Type.String({ description: "brew 必填：潜流内容" })),
    size: Type.Optional(Type.Integer({ description: "brew 必填：2-12 段" })),
    visibility: Type.Optional(Type.String({ description: "brew 必填：secret / foreshadowed" })),
    pressureType: Type.Optional(Type.String({ description: "brew 必填：压力类型" })),
    futureHook: Type.Optional(Type.String({ description: "brew 必填：未来钩子、伏笔" })),
    ticks: Type.Optional(Type.Integer({ description: "advance 必填：推进段数" })),
    reason: Type.Optional(
      Type.String({ description: "advance/disrupt/subside/extend 必填：依据" }),
    ),
    outcomeSummary: Type.Optional(Type.String({ description: "resolve-due 必填：兑现结果" })),
    dueAt: Type.Optional(
      Type.String({
        description:
          "schedule-event 必填：到期时刻。接受相对偏移（+30min/+2hours/+1day）或 ISO 字符串",
      }),
    ),
    eventId: Type.Optional(Type.String({ description: "resolve-due/extend-due 必填" })),
    newDueAt: Type.Optional(
      Type.String({
        description:
          "extend-due 必填：新到期时刻。接受相对偏移（+30min/+2hours/+1day）或 ISO 字符串",
      }),
    ),
    summary: Type.Optional(
      Type.String({
        description: "schedule-event/manifest 必填：到期会发生什么 / 显现总结",
      }),
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    manageUndercurrentTool(params, ctx.sessionManager),
};
