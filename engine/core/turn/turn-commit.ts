import type { ActorConditionEvent, ActorConditionEventResult } from "../actor/actor-condition.ts";
import type { EconomyEvent, EconomyEventResult } from "../economy/economy.ts";
import type { TrackedItemEvent } from "../inventory/tracked-item-schema.ts";
import type { TrackedItemEventResult } from "../inventory/tracked-item.ts";
import type { MemoryEvent, MemoryEventResult } from "../knowledge/memory.ts";
import type { SceneEvent, SceneEventResult } from "../scene/scene.ts";
import type { OutfitState, State, TurnTimePolicy } from "../state/state.ts";

import { findSecretSlot, collectAllSecretIds } from "../../tools/knowledge/hint-secret.ts";
import { updateActorCondition } from "../actor/actor-condition.ts";
import { changeActorOutfit } from "../actor/actor-impression.ts";
import { collectBackstageDueNotices } from "../backstage/faction-clock.ts";
import { updateEconomy } from "../economy/economy.ts";
import { applyTrackedItemEvent } from "../inventory/tracked-item.ts";
import { recordMemory } from "../knowledge/memory.ts";
import {
  openHook,
  surfaceHook,
  parkHook,
  escalateHook,
  payHook,
  retireHook,
} from "../ledger/hooks.ts";
import { assertNoOpenObligations } from "../ledger/obligations.ts";
import { updateScene } from "../scene/scene.ts";
import { assertNonEmptyString } from "../utils/typebox-validation.ts";
import { appendTurnLogEntry } from "./turn-log.ts";
import { applyTurnTime } from "./turn-time.ts";

export interface OutfitTurnEvent {
  actorId: string;
  outfit: OutfitState;
  reason: string;
}

export type HookCommitEvent =
  | { kind: "open"; label: string; reason: string }
  | { kind: "surface"; hookId: string; novelty: string; reason: string }
  | { kind: "park"; hookId: string; reason: string }
  | { kind: "escalate"; hookId: string; novelty: string; reason: string }
  | { kind: "pay"; hookId: string; reason: string }
  | { kind: "retire"; hookId: string; reason: string };

export type TurnCommitEvent =
  | { kind: "scene"; event: SceneEvent }
  | { kind: "actor-condition"; event: ActorConditionEvent }
  | { kind: "tracked-item"; event: TrackedItemEvent }
  | { kind: "economy"; event: EconomyEvent }
  | { kind: "memory"; event: MemoryEvent }
  | { kind: "outfit"; event: OutfitTurnEvent }
  | {
      kind: "hint-secret";
      event: { secretId: string; secretText?: string; hintText: string; reason: string };
    }
  | { kind: "hook"; event: HookCommitEvent };

export interface TurnCommitInput {
  summary: string;
  time: TurnTimePolicy;
  events: TurnCommitEvent[];
}

export type TurnCommitEventResult =
  | { kind: "scene"; result: SceneEventResult }
  | { kind: "actor-condition"; result: ActorConditionEventResult }
  | { kind: "tracked-item"; result: TrackedItemEventResult }
  | { kind: "economy"; result: EconomyEventResult }
  | { kind: "memory"; result: MemoryEventResult }
  | { kind: "outfit"; result: { message: string } }
  | { kind: "hint-secret"; result: { message: string } }
  | { kind: "hook"; result: { message: string } };
export interface TurnCommitResult {
  message: string;
  results: TurnCommitEventResult[];
  warnings: string[];
}

export function commitTurn(draft: State, input: TurnCommitInput): TurnCommitResult {
  const summary = assertNonEmptyString(input.summary, "summary");
  const startedAt = draft.public.clock.currentAt;
  const timeResult = applyTurnTime(draft, input.time);
  const results = input.events.map((event) => applyTurnEvent(draft, event, summary));
  assertNoOpenObligations(draft);
  const timeResults = [{ kind: "scene" as const, result: timeResult }];
  const finalResults = [...timeResults, ...results];
  appendTurnLogEntry(draft, {
    summary,
    startedAt,
    endedAt: draft.public.clock.currentAt,
    time: input.time,
    eventCount: input.events.length,
    resultCount: finalResults.length,
  });
  const warnings = collectWarnings(draft, input);
  return {
    message: formatMessage(summary, finalResults, warnings),
    results: finalResults,
    warnings,
  };
}

function applyTurnEvent(
  draft: State,
  event: TurnCommitEvent,
  _summary: string,
): TurnCommitEventResult {
  switch (event.kind) {
    case "scene":
      return { kind: event.kind, result: updateScene(draft, event.event) };
    case "actor-condition":
      return { kind: event.kind, result: updateActorCondition(draft, event.event) };
    case "tracked-item":
      return { kind: event.kind, result: applyTrackedItemEvent(draft, event.event) };
    case "economy":
      return { kind: event.kind, result: updateEconomy(draft, event.event) };
    case "memory":
      return { kind: event.kind, result: recordMemory(draft, event.event) };
    case "outfit":
      return {
        kind: event.kind,
        result: changeActorOutfit(
          draft,
          event.event.actorId,
          event.event.outfit,
          event.event.reason,
        ),
      };
    case "hint-secret":
      return { kind: event.kind, result: applyHintSecretEvent(draft, event.event) };
    case "hook":
      return { kind: event.kind, result: applyHookEvent(draft, event.event) };
    default:
      throw new Error("unreachable turn commit event kind");
  }
}

function applyHintSecretEvent(
  draft: State,
  input: { secretId: string; secretText?: string; hintText: string; reason: string },
): { message: string } {
  const found = findSecretSlot(draft, input.secretId);
  if (found === null) {
    if (input.secretText !== undefined && input.secretText.length > 0) {
      draft.secrets.hiddenWorldFacts.push({
        id: input.secretId,
        text: input.secretText,
        revealState: "foreshadowed",
        revealCondition: `已暗示（${input.reason}）`,
        relatedActorIds: [draft.public.protagonistActorId],
      });
    } else {
      const available = collectAllSecretIds(draft);
      throw new Error(
        `hint-secret: 未找到 secret ${input.secretId}。可用 secrets: ${available.length > 0 ? available.join(", ") : "无"}。如需自动创建，请传 secretText。`,
      );
    }
  } else {
    if (found.revealState === "revealed") {
      throw new Error(`hint-secret: secret ${input.secretId} 已完全揭示。`);
    }
    found.revealState = "foreshadowed";
  }

  // dedup：如果已存在关联同一秘密的 hook，复用并复现，不新建
  const existing = draft.public.hooks.find(
    (h) => h.relatedSecretId === input.secretId && !isTerminalHookStatus(h.status),
  );
  if (existing !== undefined) {
    const novelty = input.hintText;
    if (existing.status === "active") {
      existing.lastNovelty = novelty;
      existing.lastSurfacedAt = draft.public.clock.currentAt;
      existing.surfaceCount++;
    } else {
      surfaceHook(draft, existing.id, novelty);
    }
    return { message: `秘密已暗示：${input.secretId} → hook ${existing.id}（复用）` };
  }

  const hook = openHook(draft, input.hintText, input.secretId);
  return { message: `秘密已暗示：${input.secretId} → hook ${hook.id}` };
}

function isTerminalHookStatus(status: string): boolean {
  return status === "paid" || status === "retired";
}

function applyHookEvent(draft: State, event: HookCommitEvent): { message: string } {
  switch (event.kind) {
    case "open":
      openHook(draft, event.label);
      return { message: `hook 已创建：${event.label}` };
    case "surface":
      surfaceHook(draft, event.hookId, event.novelty);
      return { message: `hook ${event.hookId} 已复现` };
    case "park":
      parkHook(draft, event.hookId, event.reason);
      return { message: `hook ${event.hookId} 已暂存` };
    case "escalate":
      escalateHook(draft, event.hookId, event.novelty);
      return { message: `hook ${event.hookId} 已升级` };
    case "pay":
      payHook(draft, event.hookId, event.reason);
      return { message: `hook ${event.hookId} 已兑现` };
    case "retire":
      retireHook(draft, event.hookId, event.reason);
      return { message: `hook ${event.hookId} 已退场` };
  }
}

function collectWarnings(draft: State, input: TurnCommitInput): string[] {
  const warnings: string[] = [];
  warnings.push(...collectPacingWarnings(input));
  warnings.push(...collectBackstageDueNotices(draft));
  return warnings;
}

function collectPacingWarnings(input: TurnCommitInput): string[] {
  const warnings: string[] = [];
  if (input.events.length >= 6) {
    warnings.push(
      "叙事节奏提醒：这一轮你提交了 6 个以上的领域事件（scene / economy / memory / actor-condition 等状态变更），已经比较饱满了。\n接下来请不要再继续推进新的前台场景冲突——先把这轮已有的操作后果写清楚：\n- 角色的行动意图得到了什么结果？\n- 付出了什么代价、消耗了什么资源？\n- NPC 对当前发生的事有什么反应（对白、态度、沉默或行动）？\n- 场景里自然浮现出了什么新的局面，让玩家知道接下来可以往哪走？\n\n让当前这轮的内容沉淀下来，不要急着把下一场冲突也塞进同一轮里。",
    );
  }
  if (input.time.elapsedMinutes > 30) {
    warnings.push(
      "叙事节奏提醒：这一轮的游戏内时间推进了 30 分钟以上，时间跨度已经不小了。在这么长的一段游戏时间里，很多细节可能已经被跳过。\n接下来，除了必要的幕后记录（比如记录 offscreen 事件——这些是「世界在玩家视野之外发生的事」）以外，请不要继续推进新的前台场景冲突了。\n让这 30 分钟里发生的事情在叙事中充分展开：角色经历了什么、环境有什么变化、NPC 之间有什么暗流在涌动。不要急着跳过细节去赶下一场戏。",
    );
  }
  return warnings;
}

function formatMessage(
  summary: string,
  results: TurnCommitEventResult[],
  warnings: readonly string[],
): string {
  const lines = [`回合已提交：${summary}`, `领域事件：${results.length}`];
  if (warnings.length > 0) {
    lines.push("检查提醒：", ...warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}
