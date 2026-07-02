/**
 * GM-only backstage ledger brief (secret tier — NEVER enters public projection / renderer).
 *
 * This is the standing, decision-time projection of the backstage ledgers so the GM
 * perceives offscreen debt BEFORE composing the turn (and can weave foreshadowing in the
 * same beat) rather than only learning about it reactively from a tool return AFTER commit.
 * It reads secrets.backstageObligations + backstagePendingHarvests + backstagePressure.
 *
 * Firewall: this text is injected ONLY through the settlement (Pass A / GM) preset; the
 * renderer (Pass B) preset contains no runtime:backstage-ledger module, so it is physically
 * unreachable from player-facing prose. Do not wire this into public-projection.ts.
 */

import type { State } from "../state/state.ts";

import { BACKSTAGE_NO_COST_STREAK_LIMIT } from "./backstage-obligation.ts";

export function buildBackstageGmBrief(state: State): string {
  const obligations = state.secrets.backstageObligations;
  const pending = state.secrets.backstagePendingHarvests;
  const streak = state.secrets.backstagePressure.consecutiveNoCostTurns;

  const lines: string[] = [];

  if (obligations.length > 0) {
    lines.push(
      `未清后台义务 ${obligations.length} 条（canonical commit 前必须清账，否则硬阻断本轮提交）：`,
    );
    for (const obligation of obligations) {
      lines.push(`- ${obligation.summary}`);
    }
  }

  if (pending.length > 0) {
    lines.push(`待 harvest 的后台 director run ${pending.length} 个：`);
    for (const entry of pending) {
      lines.push(
        `- run_id=${entry.runId}（line ${entry.lineId}，起于 ${entry.spawnedAt}）→ 用 run_id 调 harvest_backstage_candidate 取回审查，再 manage_undercurrent 落地。`,
      );
    }
  }

  // 无义务但 no-cost 连击临近阈值：提前预警，GM 可主动起一条后台线避免被自动义务硬推。
  if (obligations.length === 0 && streak >= BACKSTAGE_NO_COST_STREAK_LIMIT - 1) {
    lines.push(
      `后台压力：已连续 ${streak} 个 no-cost 回合（阈值 ${BACKSTAGE_NO_COST_STREAK_LIMIT}，命中即自动生成后台推进义务）。`,
    );
  }

  if (lines.length === 0) {
    return "后台平行线账本：当前无未清义务、无待 harvest run、压力正常。需要时用 run_parallel_line 起一条后台线。";
  }

  return lines.join("\n");
}
