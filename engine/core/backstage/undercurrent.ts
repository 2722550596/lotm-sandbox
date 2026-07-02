/**
 * 潜流与到期义务（backlog #3，BITD 进度钟）。
 *
 * 「世界不为玩家暂停」从 prompt 自觉变成机械载体：幕后势力的推进记在
 * secret state 的 undercurrents / scheduledEvents 里；canonical commit
 * 推进时间越过 dueAt 或潜流填满时，工具返回值直接催账——GM 不需要记得。
 */

import type { Undercurrent, ScheduledEvent, State } from "../state/state.ts";

import { Temporal } from "@js-temporal/polyfill";

import { openHook } from "../ledger/hooks.ts";
import { resolveRelativeTime } from "../state/date-time.ts";
import { createId } from "../utils/ids.ts";
import {
  assertIsoDateString,
  assertNonEmptyString,
  assertNonNegativeInteger,
} from "../utils/typebox-validation.ts";

export interface UndercurrentInput {
  clockId?: string;
  actorIds: string[];
  label: string;
  size: number;
  visibility: Undercurrent["visibility"];
  pressureType: string;
  futureHook: string;
}

export function brewUndercurrent(draft: State, input: UndercurrentInput): Undercurrent {
  const size = assertNonNegativeInteger(input.size, "size");
  if (size < 2 || size > 12) {
    throw new Error(`非法 size: ${size}。undercurrent 大小必须在 2-12 之间。`);
  }
  const label = assertNonEmptyString(input.label, "label");

  const existing =
    input.clockId === undefined
      ? undefined
      : draft.secrets.undercurrents.find((uc) => uc.id === input.clockId);
  if (existing !== undefined) {
    existing.actorIds = input.actorIds;
    existing.label = label;
    existing.size = size;
    existing.visibility = input.visibility;
    existing.pressureType = input.pressureType;
    existing.futureHook = input.futureHook;
    existing.lastChangedAt = draft.public.clock.currentAt;
    if (existing.filled > size) existing.filled = size;
    return existing;
  }
  const undercurrent: Undercurrent = {
    id: input.clockId ?? createId(draft, "undercurrent"),
    actorIds: input.actorIds,
    label,
    filled: 0,
    size,
    visibility: input.visibility,
    pressureType: input.pressureType,
    futureHook: input.futureHook,
    lastChangedAt: draft.public.clock.currentAt,
  };
  draft.secrets.undercurrents.push(undercurrent);
  return undercurrent;
}

export interface AdvanceUndercurrentResult {
  clock: Undercurrent;
  becameFull: boolean;
}

export function advanceUndercurrent(
  draft: State,
  undercurrentId: string,
  ticks: number,
  reason: string,
): AdvanceUndercurrentResult {
  assertNonEmptyString(reason, "reason");
  const ticksValue = assertNonNegativeInteger(ticks, "ticks");
  if (ticksValue === 0) {
    throw new Error("ticks 必须大于 0；不推进就不要调用 advance-undercurrent。");
  }
  const uc = requireUndercurrent(draft, undercurrentId);
  const wasFull = uc.filled >= uc.size;
  uc.filled = Math.min(uc.size, uc.filled + ticksValue);
  uc.lastChangedAt = draft.public.clock.currentAt;
  return { clock: uc, becameFull: !wasFull && uc.filled >= uc.size };
}

export function manifestUndercurrent(
  draft: State,
  undercurrentId: string,
  summary: string,
): Undercurrent {
  const summaryValue = assertNonEmptyString(summary, "summary");
  const uc = requireUndercurrent(draft, undercurrentId);
  if (uc.futureHook) {
    openHook(draft, uc.futureHook, undercurrentId);
  }
  draft.secrets.secretEventLog.push({
    id: createId(draft, "secret-event"),
    time: draft.public.clock.currentAt,
    summary: `[undercurrent:${uc.label}] ${summaryValue}`,
    relatedActorIds: [],
  });
  draft.secrets.undercurrents = draft.secrets.undercurrents.filter(
    (entry) => entry.id !== undercurrentId,
  );
  return uc;
}

export function disruptUndercurrent(
  draft: State,
  undercurrentId: string,
  reason: string,
): Undercurrent {
  const reasonValue = assertNonEmptyString(reason, "reason");
  const uc = requireUndercurrent(draft, undercurrentId);
  draft.secrets.secretEventLog.push({
    id: createId(draft, "secret-event"),
    time: draft.public.clock.currentAt,
    summary: `[undercurrent:${uc.label}] ${reasonValue}`,
    relatedActorIds: [],
  });
  draft.secrets.undercurrents = draft.secrets.undercurrents.filter(
    (entry) => entry.id !== undercurrentId,
  );
  return uc;
}

export function subsideUndercurrent(
  draft: State,
  undercurrentId: string,
  reason: string,
): Undercurrent {
  const reasonValue = assertNonEmptyString(reason, "reason");
  const uc = requireUndercurrent(draft, undercurrentId);
  draft.secrets.secretEventLog.push({
    id: createId(draft, "secret-event"),
    time: draft.public.clock.currentAt,
    summary: `[undercurrent:${uc.label}] ${reasonValue}`,
    relatedActorIds: [],
  });
  draft.secrets.undercurrents = draft.secrets.undercurrents.filter(
    (entry) => entry.id !== undercurrentId,
  );
  return uc;
}

export function scheduleEvent(draft: State, dueAt: string, summary: string): ScheduledEvent {
  const due = assertIsoDateString(
    resolveRelativeTime(dueAt, draft.public.clock.currentAt),
    "dueAt",
  );
  if (Temporal.Instant.compare(Temporal.Instant.from(due), currentInstant(draft)) <= 0) {
    throw new Error(`非法 dueAt: ${due} 不晚于当前游戏时间 ${draft.public.clock.currentAt}。`);
  }
  const event: ScheduledEvent = {
    id: createId(draft, "scheduled-event"),
    dueAt: due,
    summary: assertNonEmptyString(summary, "summary"),
  };
  draft.secrets.scheduledEvents.push(event);
  return event;
}

/** 到期处理：兑现（记入 secretEventLog）后移除。 */
export function resolveScheduledEvent(
  draft: State,
  eventId: string,
  outcomeSummary: string,
): ScheduledEvent {
  const summary = assertNonEmptyString(outcomeSummary, "outcomeSummary");
  const event = requireScheduledEvent(draft, eventId);
  draft.secrets.secretEventLog.push({
    id: createId(draft, "secret-event"),
    time: draft.public.clock.currentAt,
    summary: `[scheduled:${event.summary}] ${summary}`,
    relatedActorIds: [],
  });
  draft.secrets.scheduledEvents = draft.secrets.scheduledEvents.filter(
    (entry) => entry.id !== eventId,
  );
  return event;
}

/** 显式展期：到期但本轮不便兑现时的合法出口。 */
export function extendScheduledEvent(
  draft: State,
  eventId: string,
  newDueAt: string,
  reason: string,
): ScheduledEvent {
  assertNonEmptyString(reason, "reason");
  const due = assertIsoDateString(
    resolveRelativeTime(newDueAt, draft.public.clock.currentAt),
    "newDueAt",
  );
  const event = requireScheduledEvent(draft, eventId);
  if (Temporal.Instant.compare(Temporal.Instant.from(due), currentInstant(draft)) <= 0) {
    throw new Error(`非法 newDueAt: ${due} 不晚于当前游戏时间，展期无意义。`);
  }
  event.dueAt = due;
  return event;
}

/**
 * canonical commit 的催账清单：已到期的 scheduledEvents + 已填满的潜流。
 * 只生成提醒文本，不改 state——到期处理必须走 manage_undercurrent 显式动作。
 */
export function collectBackstageDueNotices(draft: State): string[] {
  const now = currentInstant(draft);
  const notices: string[] = [];
  for (const event of draft.secrets.scheduledEvents) {
    if (Temporal.Instant.compare(Temporal.Instant.from(event.dueAt), now) <= 0) {
      notices.push(
        `⏰ 幕后倒计时已到期（${event.id}）：${event.summary}——本轮必须处理（resolve-due）或显式展期（extend-due）。`,
      );
    }
  }
  for (const uc of draft.secrets.undercurrents) {
    if (uc.filled >= uc.size) {
      notices.push(
        `⏰ 潜流已填满（${uc.id}｜${uc.label}）：必须兑现一次格局变化，然后 manifest/disrupt/subsidence。`,
      );
    }
  }
  return notices;
}

function requireUndercurrent(draft: State, undercurrentId: string): Undercurrent {
  const id = assertNonEmptyString(undercurrentId, "undercurrentId");
  const uc = draft.secrets.undercurrents.find((entry) => entry.id === id);
  if (uc === undefined) {
    const known = draft.secrets.undercurrents.map((entry) => entry.id).join(", ") || "（无）";
    throw new Error(`undercurrent 不存在: ${id}。已有潜流: ${known}。`);
  }
  return uc;
}

function requireScheduledEvent(draft: State, eventId: string): ScheduledEvent {
  const id = assertNonEmptyString(eventId, "eventId");
  const event = draft.secrets.scheduledEvents.find((entry) => entry.id === id);
  if (event === undefined) {
    const known = draft.secrets.scheduledEvents.map((entry) => entry.id).join(", ") || "（无）";
    throw new Error(`scheduled event 不存在: ${id}。待办事件: ${known}。`);
  }
  return event;
}

function currentInstant(draft: State): Temporal.Instant {
  return Temporal.Instant.from(draft.public.clock.currentAt);
}
