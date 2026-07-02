import type {
  BackstageObligation,
  BackstageResolutionOutcome,
  BackstageTrigger,
  State,
} from "../state/state.ts";

import { createId } from "../utils/ids.ts";
import { assertNonEmptyString } from "../utils/typebox-validation.ts";

/** 单轮时间推进达到此分钟数即触发后台推进义务。沿用 audit 阈值。 */
export const BACKSTAGE_BIG_TIME_ADVANCE_MINUTES = 120;
/** 连续无代价 canonical turn 达到此数即触发。 */
export const BACKSTAGE_NO_COST_STREAK_LIMIT = 6;

export interface CanonicalTurnBackstageInput {
  /** 本轮推进的游戏内分钟数 */
  elapsedMinutes: number;
  /** 本轮是否产生机械代价（伤势/资源/威胁/记忆等），用于打断 no-cost 连击 */
  hasCost: boolean;
  /** 本轮是否是 beat 收口（commit_turn 的 complete-beat scene 事件） */
  beatBoundary: boolean;
}

/**
 * canonical commit 开始前的硬阻断：账未清则拒绝整次提交。
 * 清账路径写进错误文案，引导 GM 先推进后台世界线。
 */
export function assertNoOpenBackstageObligation(draft: State): void {
  const open = draft.secrets.backstageObligations;
  if (open.length > 0) {
    throw new Error(formatOpenBackstageObligations(open));
  }
}

/**
 * canonical turn 收尾记账：更新 no-cost 连击计数，命中触发器则生成一条义务。
 * 已有未清账义务时不再叠加（同一时刻至多一条待办）。
 */
export function recordCanonicalTurnForBackstage(
  draft: State,
  input: CanonicalTurnBackstageInput,
): BackstageObligation | null {
  const pressure = draft.secrets.backstagePressure;
  if (input.hasCost || input.beatBoundary) {
    pressure.consecutiveNoCostTurns = 0;
  } else {
    pressure.consecutiveNoCostTurns += 1;
  }

  const bigTimeAdvance = input.elapsedMinutes >= BACKSTAGE_BIG_TIME_ADVANCE_MINUTES;
  const noCostStreak = pressure.consecutiveNoCostTurns >= BACKSTAGE_NO_COST_STREAK_LIMIT;
  const trigger: BackstageTrigger | null = input.beatBoundary
    ? "beat-complete"
    : bigTimeAdvance
      ? "time-advance"
      : noCostStreak
        ? "no-cost-streak"
        : null;
  if (trigger === null) {
    return null;
  }
  // 已有未清账义务：不叠加，等它先被清掉。
  if (draft.secrets.backstageObligations.length > 0) {
    return null;
  }
  const obligation: BackstageObligation = {
    id: createId(draft, "backstage-obligation"),
    trigger,
    summary: formatTriggerSummary(trigger, input),
    createdAt: draft.public.clock.currentAt,
  };
  draft.secrets.backstageObligations.push(obligation);
  // 生成后立即清零连击，避免下一轮还没清账就再次命中 no-cost-streak。
  pressure.consecutiveNoCostTurns = 0;
  return obligation;
}

export interface BackstageResolutionInput {
  outcome: BackstageResolutionOutcome;
  reasonCode: string;
  note: string;
}

/**
 * 清掉最旧的一条未清账义务（FIFO），写入审查记录，并重置 no-cost 连击。
 * 没有未清账义务时返回 undefined（调用方决定是否报错）。
 */
export function settleOldestBackstageObligation(
  draft: State,
  input: BackstageResolutionInput,
): BackstageObligation | undefined {
  const settled = draft.secrets.backstageObligations.shift();
  if (settled === undefined) {
    return undefined;
  }
  draft.secrets.backstageReviewLog.push({
    id: createId(draft, "backstage-review"),
    obligationId: settled.id,
    outcome: input.outcome,
    reasonCode: assertNonEmptyString(input.reasonCode, "reasonCode"),
    note: assertNonEmptyString(input.note, "note"),
    reviewedAt: draft.public.clock.currentAt,
  });
  draft.secrets.backstagePressure.consecutiveNoCostTurns = 0;
  return settled;
}

/** 后台进展打断 no-cost 连击（落地任何 offscreen 事件时调用）。 */
export function resetBackstagePressure(draft: State): void {
  draft.secrets.backstagePressure.consecutiveNoCostTurns = 0;
}

function formatTriggerSummary(
  trigger: BackstageTrigger,
  input: CanonicalTurnBackstageInput,
): string {
  switch (trigger) {
    case "beat-complete":
      return "Scene Beat 收口了——幕后的世界也该跟着推进一轮。用 run_parallel_line 跑个后台导演，或者自己推演后 record_offscreen_event。";
    case "time-advance":
      return `本轮推进了 ${input.elapsedMinutes} 分钟（≥${BACKSTAGE_BIG_TIME_ADVANCE_MINUTES} 分钟触发阈值）——时间跨度够大，幕后的世界也该同步推进一轮。`;
    case "no-cost-streak":
      return `连续 ${BACKSTAGE_NO_COST_STREAK_LIMIT} 轮都没有消耗资源或产生代价——幕后的世界应该有点动静了。考虑跑一轮后台线。`;
    default:
      return "有后台待处理。先处理再开始新的一轮。";
  }
}

function formatOpenBackstageObligations(obligations: readonly BackstageObligation[]): string {
  return [
    "存在未处理的后台世界线推进提醒，无法开始新的一轮。请先处理后台：",
    ...obligations.map((entry) => `- [${entry.trigger}] ${entry.summary}`),
    "处理方式：",
    "用 record_offscreen_event 记录幕后发生的事件（有真实进展时），或用 resolve_backstage_line 确认本轮无变化（no-change/blocked）。",
    "每条 record_offscreen_event 落地后会自动清掉一条待办。",
  ].join("\n");
}
