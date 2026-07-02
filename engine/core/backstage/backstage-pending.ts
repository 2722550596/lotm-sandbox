/**
 * Backstage pending-harvest ledger (engine-enforced — ADR 0003 dunning + ADR 0005 loop).
 *
 * run_parallel_line forks a director and records a pending-harvest marker here.
 * Until the GM harvests that run (harvest_backstage_candidate clears it) the engine
 * duns it on every canonical commit, and resolve_backstage_line REFUSES to declare
 * no-change/blocked while an unharvested run sits ready — so a produced candidate
 * cannot be silently discarded by a forgetful "no-change". Landing a candidate
: * (manage_undercurrent) also clears the marker for that line.
 */

import type { BackstagePendingHarvest, State } from "../state/state.ts";

export interface PendingHarvestInput {
  runId: string;
  lineId: string;
}

/** Record (or refresh) a pending-harvest marker for a freshly spawned director run. */
export function recordPendingHarvest(draft: State, input: PendingHarvestInput): void {
  const pending = draft.secrets.backstagePendingHarvests;
  const existing = pending.find((entry) => entry.runId === input.runId);
  if (existing !== undefined) {
    existing.lineId = input.lineId;
    existing.spawnedAt = draft.public.clock.currentAt;
    return;
  }
  pending.push({
    runId: input.runId,
    lineId: input.lineId,
    spawnedAt: draft.public.clock.currentAt,
  });
}

/** Clear the marker for a run once it has been harvested (retrieved + reviewed). Returns true if one was removed. */
export function clearPendingHarvestByRun(draft: State, runId: string): boolean {
  const pending = draft.secrets.backstagePendingHarvests;
  const idx = pending.findIndex((entry) => entry.runId === runId);
  if (idx === -1) {
    return false;
  }
  pending.splice(idx, 1);
  return true;
}

/** Clear markers for a line once a candidate for it has landed. Returns the count removed. */
export function clearPendingHarvestByLine(draft: State, lineId: string): number {
  const pending = draft.secrets.backstagePendingHarvests;
  let removed = 0;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i]?.lineId === lineId) {
      pending.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Guard for resolve_backstage_line: refuse to declare no-change/blocked while a
 * spawned-but-unharvested run exists, so its produced candidate is not discarded.
 * The GM must harvest first (which clears the marker), then resolve if warranted.
 */
export function assertNoUnharvestedPending(draft: State): void {
  const pending = draft.secrets.backstagePendingHarvests;
  if (pending.length === 0) {
    return;
  }
  throw new Error(formatUnharvestedPending(pending));
}

function formatUnharvestedPending(pending: readonly BackstagePendingHarvest[]): string {
  return [
    "有已起飞但尚未 harvest 的后台 director run，拒绝 resolve_backstage_line（避免把已产出的候选当 no-change 丢弃）：",
    ...pending.map((entry) => `- run_id=${entry.runId}（line ${entry.lineId}）`),
    "先 harvest_backstage_candidate(run_id) 取回候选审查：",
    "- 有 progress/escalation → manage_undercurrent 落地；",
    "- 审查后确属 no-change/blocked → harvest 已清掉该 run 的 pending，再 resolve_backstage_line。",
  ].join("\n");
}

/** Dunning line for canonical-commit returns; null when nothing is pending. */
export function formatPendingHarvestReminder(draft: State): string | null {
  const pending = draft.secrets.backstagePendingHarvests;
  if (pending.length === 0) {
    return null;
  }
  const runs = pending.map((entry) => `${entry.runId}（${entry.lineId}）`).join("、");
  return `⏳ 后台 director 已起、候选待 harvest：${runs}。隔轮用 run_id 调 harvest_backstage_candidate 取回审查后落地（manage_undercurrent）或清账（resolve_backstage_line）。`;
}
