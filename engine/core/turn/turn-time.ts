import type { SceneEventResult } from "../scene/scene.ts";
import type { State, TurnTimePolicy } from "../state/state.ts";

import { Temporal } from "@js-temporal/polyfill";

import { assertNonEmptyString, assertNonNegativeInteger } from "../utils/typebox-validation.ts";

/** 不经过 Scene Beat/Turn Commit 的裸时钟推进，供初始化与测试准备使用。 */
export function advanceClock(draft: State, minutes: number, reason: string): void {
  if (reason.trim().length === 0) {
    throw new Error("advanceClock 必须提供 reason。");
  }
  const elapsedMinutes = assertNonNegativeInteger(minutes, "elapsedMinutes");
  const nextTime = Temporal.Instant.from(draft.public.clock.currentAt)
    .add({ minutes: elapsedMinutes })
    .toString({ fractionalSecondDigits: 3 });
  draft.public.clock.currentAt = nextTime;
  draft.public.scene.lastResolvedAt = nextTime;
}

export function applyTurnTime(draft: State, time: TurnTimePolicy): SceneEventResult {
  assertNonEmptyString(time.reason, "time.reason");
  switch (time.kind) {
    case "elapsed":
      return advanceTurnTime(draft, time.elapsedMinutes);
    case "travel":
      return travelTurnTime(draft, time);
    default:
      throw new Error("unreachable turn time kind");
  }
}

function advanceTurnTime(draft: State, elapsedMinutesInput: number): SceneEventResult {
  const elapsedMinutes = assertNonNegativeInteger(elapsedMinutesInput, "elapsedMinutes");
  const nextTime = Temporal.Instant.from(draft.public.clock.currentAt)
    .add({ minutes: elapsedMinutes })
    .toString({ fractionalSecondDigits: 3 });
  draft.public.clock.currentAt = nextTime;
  draft.public.scene.lastResolvedAt = nextTime;
  return { message: `时间已推进 ${elapsedMinutes} 分钟。` };
}

function travelTurnTime(
  draft: State,
  time: Extract<TurnTimePolicy, { kind: "travel" }>,
): SceneEventResult {
  const elapsedMinutes = assertNonNegativeInteger(time.elapsedMinutes, "elapsedMinutes");
  const nextTime = Temporal.Instant.from(draft.public.clock.currentAt)
    .add({ minutes: elapsedMinutes })
    .toString({ fractionalSecondDigits: 3 });
  draft.public.clock.currentAt = nextTime;
  draft.public.scene.lastResolvedAt = nextTime;
  draft.public.scene.location = time.location;
  return { message: `地点已更新，经过 ${elapsedMinutes} 分钟。` };
}
