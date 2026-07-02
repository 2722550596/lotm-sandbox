/**
 * Turn obligations ledger（backlog #4）。
 *
 * 裁决类工具（如 resolve_combat）只判定不改状态，伤势/威胁等
 * 「必须落地」项以前靠 GM 自觉跟进——这是无人看守的缝隙。
 * 现在裁决产生的 mandatory landing 记入账本，对应领域事件成功执行时
 * 自动清账（FIFO，一次事件清一条），commit_turn 在收尾时对账：账未清则拒绝提交。
 */

import type { State, TurnObligation, TurnObligationKind } from "../state/state.ts";

import { createId } from "../utils/ids.ts";

export interface RecordObligationInput {
  source: string;
  kind: TurnObligationKind;
  summary: string;
}

export function recordObligation(draft: State, input: RecordObligationInput): TurnObligation {
  const obligation: TurnObligation = {
    id: createId(draft, "obligation"),
    source: input.source,
    kind: input.kind,
    summary: input.summary,
    createdAt: draft.public.clock.currentAt,
  };
  draft.public.obligations.push(obligation);
  return obligation;
}

/**
 * 清账：领域事件成功执行后调用。FIFO，一次只清一条同类义务——
 * 一次落地动作不应抵销多条欠账。
 */
export function settleOldestObligation(
  draft: State,
  kinds: readonly TurnObligationKind[],
): TurnObligation | undefined {
  const index = draft.public.obligations.findIndex((entry) => kinds.includes(entry.kind));
  if (index === -1) return undefined;
  const [settled] = draft.public.obligations.splice(index, 1);
  return settled;
}

export const OBLIGATION_KIND_GUIDANCE: Record<TurnObligationKind, string> = {
  "scene-objective": "commit_turn 的 scene 事件（add-objective / resolve-objective）",
  "scene-threat": "commit_turn 的 scene 事件（add-threat / clear-threat）",
  "actor-condition": "actor-condition 事件（update_actor_condition 或 commit_turn）",
  equipment: "equipment 事件（combat-exchange 装备状态变化）",
  sequence: "sequence 事件（upsert-sequence 或 commit_turn）",
  memory: "memory 事件（record_memory 或 commit_turn）",
  "reveal-secret": "reveal_secret 工具",
  "tracked-item": "tracked-item 事件（update_tracked_item 或 commit_turn）",
};

/** 对账失败时的拒绝文案：列出每条欠账与对应的落地路径。 */
export function formatOpenObligations(obligations: readonly TurnObligation[]): string {
  return [
    "本轮存在未落地的裁决义务，拒绝提交。先把账清掉再 commit：",
    ...obligations.map(
      (entry) =>
        `- [${entry.kind}] ${entry.summary}（来源：${entry.source}；落地方式：${OBLIGATION_KIND_GUIDANCE[entry.kind]}）`,
    ),
  ].join("\n");
}

/** canonical commit 收尾对账：账未清则抛错，整次提交回滚。 */
export function assertNoOpenObligations(draft: State): void {
  if (draft.public.obligations.length > 0) {
    throw new Error(formatOpenObligations(draft.public.obligations));
  }
}
