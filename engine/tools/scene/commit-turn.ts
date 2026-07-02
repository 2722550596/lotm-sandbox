import type { TurnCommitEvent } from "../../core/turn/turn-commit.ts";
import type { DomainToolDefinition } from "../runtime/tool-definition.ts";
import type { ToolResult } from "../runtime/tool-result.ts";

import { Type } from "typebox";

import {
  assertNoOpenBackstageObligation,
  recordCanonicalTurnForBackstage,
} from "../../core/backstage/backstage-obligation.ts";
import { formatPendingHarvestReminder } from "../../core/backstage/backstage-pending.ts";
import { commitTurn } from "../../core/turn/turn-commit.ts";
import { resultDetails, runDomainEventTool } from "../system/domain-tool-runner.ts";
import { normalizeTurnCommitInput } from "./commit-turn-normalizer.ts";
import { timePolicySchema } from "./time-policy-tool-schema.ts";

// 本轮是否产生机械代价：用于打断后台 no-cost 连击。可检测核心集。
const COST_EVENT_KINDS = new Set(["actor-condition", "economy", "memory"]);
function turnHasCost(events: readonly TurnCommitEvent[]): boolean {
  return events.some((event) => {
    if (COST_EVENT_KINDS.has(event.kind)) {
      return true;
    }
    return event.kind === "scene" && event.event.kind === "add-threat";
  });
}

function hasCompleteBeat(events: readonly TurnCommitEvent[]): boolean {
  return events.some(
    (event) => event.kind === "scene" && event.event.kind === "complete-beat",
  );
}

export function commitTurnTool(params: unknown, sessionManager: unknown): ToolResult {
  const input = normalizeTurnCommitInput(params);
  return runDomainEventTool({
    sessionManager,
    execute: (draft) => {
      if (draft.public.pendingDirectionPacket) {
        throw new Error(
          "上一轮 commit_turn 已完成但尚未调用 submit_direction_packet 输出叙事。请先调 submit_direction_packet，再开启新一轮。每轮只走一次 commit_turn → submit_direction_packet。",
        );
      }
      // 延迟硬阻断：上一轮触发的后台推进义务未清账则拒绝本次 canonical turn。
      assertNoOpenBackstageObligation(draft);
      const result = commitTurn(draft, input);
      recordCanonicalTurnForBackstage(draft, {
        elapsedMinutes: input.time.elapsedMinutes,
        hasCost: turnHasCost(input.events),
        beatBoundary: hasCompleteBeat(input.events),
      });
      draft.public.pendingDirectionPacket = true;
      return { result, pendingReminder: formatPendingHarvestReminder(draft) };
    },
    details: ({ result }) => resultDetails(result),
    message: ({ result, pendingReminder }) =>
      pendingReminder === null ? result.message : `${result.message}\n\n${pendingReminder}`,
  });
}

export const commitTurnToolDefinition: DomainToolDefinition = {
  name: "commit_turn",
  description:
    "每轮叙事结束时，用这个工具一次性提交本轮所有状态变化。把这轮里发生的各种变化——经济收支、记忆记录、角色状态、场景更新——打包放进 events 数组。每轮只能调一次，且调完后必须调 submit_direction_packet 才能调下一次。\n\n时间推进：顶层 time 必填，elapsedMinutes >= 1（即使感觉只过了瞬间也至少 1 分钟）。时间推进是独立的，不要写在 events 里。\n地点移动：用 time.kind=travel，不用写 events。\n\nevents 数组示例：\n  { kind: \"economy\", event: { purseId: \"purse-xxx\", amount: 9, reason: \"买面包\" } }\n  { kind: \"memory\", event: { kind: \"pin-fact\", scope: \"protagonist\", subject: \"克莱恩\", text: \"...\" } }\n  { kind: \"actor-condition\", event: { kind: \"add-affliction\", actorId: \"...\", ... } }\n  { kind: \"scene\", event: { kind: \"begin-beat\", title: \"调查教堂\", objectives: [...] } }\n  { kind: \"scene\", event: { kind: \"complete-beat\", outcome: \"...\" } }\n\n允许的 event kind：\n- scene：场景更新（含 begin-beat/complete-beat 子事件），也是创建/收口 Scene Beat 的唯一方式\n- scene-presence：调整当前场景的在场 NPC\n- actor-condition：给角色添加/移除状态效果或装备\n- outfit：更换角色的外貌/着装\n- economy：经济收支\n- memory：记录记忆或钉住关键事实\n\n序列晋升用 attempt_promotion，扮演反馈用 record_acting_feedback，它们不属于每轮常规操作，不走 commit_turn。\n\n【什么时候用】\n- 每轮叙事正文写完之后，把该落地的状态变化一次性提交\n- events 里可同时包含状态变化和 beat 操作（begin-beat/complete-beat）\n\n【不要这样做】\n- 同一轮内调多次 commit_turn（有 guard 阻止）\n- 不调 commit_turn 就直接 submit_direction_packet needsRender=true（有 guard 阻止）",
  parameters: Type.Object({
    summary: Type.Optional(
      Type.String({
        description: "本轮玩家可见状态变化摘要；省略时自动生成",
      }),
    ),
    time: timePolicySchema(),
    events: Type.Array(
      Type.Object({
        kind: Type.String({
          description:
            "scene / scene-presence / actor-condition / outfit / economy / memory",
        }),
        event: Type.Unknown({
          description:
            "领域事件载荷，两层嵌套：外层 kind 声明领域类型（如 memory），内层 event 对象含具体子类型（如 { kind: \"pin-fact\", ... }）。\n" +
            "格式速查（外层 kind→内层 event 结构）：\n" +
            "  scene（内层 event.kind 决定字段）：\n" +
            '    begin-beat → { kind:"begin-beat", title, objectives, purpose, beatId?, actionPolicy?, threats?, presence?, situation? }\n' +
            '    complete-beat → { kind:"complete-beat", outcome, memory?, nextBeat?, presence?, situation? }\n' +
            '    add-objective → { kind:"add-objective", summary, reason }\n' +
            '    resolve-objective → { kind:"resolve-objective", objectiveSummary/objectiveId?, reason }\n' +
            '    add-threat → { kind:"add-threat", summary, severity:"low"|"medium"|"high"|"lethal", reason }\n' +
            '    clear-threat → { kind:"clear-threat", threatSummary/threatId?, reason }\n' +
            '    set-location → { kind:"set-location", location:{region,site,detail,boundary}, reason }\n' +
            '    set-situation → { kind:"set-situation", situation:"daily"|"investigation"|"social"|"combat"|"ritual"|"escape"|"downtime", reason }\n' +
            '    scene-presence → { kind:"scene-presence", presentActorIds, allyActorIds, reason }\n' +
            "  actor-condition→{ kind:\"add-affliction\"|\"resolve-condition\"|\"update-wound\", actorId, ... }\n" +
            "  memory→{ kind:\"pin-fact\"|\"record-major-event\"|\"record-daily-summary\", scope, subject, text, ... }\n" +
            "  economy→{ kind, amount, purseId?, ... }\n" +
            "  outfit→{ actorId, outfit, ... }\n" +
            "不包含时间/移动。",
        }),
      }),
      {
        description: "本轮所有状态变化清单；每轮必须至少 1 条",
      },
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    commitTurnTool(params, ctx.sessionManager),
};
