/**
 * Mystery hook 账本（backlog #2）。
 *
 * gm-story-driver 的 hook budget（active 上限、parked 冷却、复现必带新状态）
 * 以前全活在 prompt 里——compaction 后只能靠叙事质感苟活，审计无账可查。
 * 现在 hook 是领域对象：active 压力上限是硬 invariant，复现/升级/兑现
 * 强制写 novelty，paid/retired 终态留在账本里供 timeline-showrunner 对账。
 */

import type { HookState, State } from "../state/state.ts";

import { createId } from "../utils/ids.ts";
import { assertNonEmptyString } from "../utils/typebox-validation.ts";

/** 同时施压（active + escalated）的 hook 数量上限。 */
export const MAX_ACTIVE_HOOKS = 2;

const TERMINAL_STATUSES: readonly HookState["status"][] = ["paid", "retired"];

export function openHook(draft: State, label: string, relatedSecretId?: string): HookState {
  const labelValue = assertNonEmptyString(label, "label");
  assertActiveBudget(draft);
  const hook: HookState = {
    id: createId(draft, "hook"),
    label: labelValue,
    status: "active",
    lastSurfacedAt: draft.public.clock.currentAt,
    surfaceCount: 1,
    lastNovelty: "",
    relatedSecretId,
  };
  draft.public.hooks.push(hook);
  return hook;
}

/** 复现：必须带新状态。parked hook 复现即重新 active（占预算）。 */
export function surfaceHook(draft: State, hookId: string, novelty: string): HookState {
  const hook = requireLiveHook(draft, hookId);
  const noveltyValue = assertNonEmptyString(novelty, "novelty");
  if (hook.status === "parked") {
    assertActiveBudget(draft);
    hook.status = "active";
  }
  recordSurface(draft, hook, noveltyValue);
  return hook;
}

export function parkHook(draft: State, hookId: string, reason: string): HookState {
  assertNonEmptyString(reason, "reason");
  const hook = requireLiveHook(draft, hookId);
  hook.status = "parked";
  return hook;
}

/** 升级：压力上调，算一次复现，必须带新状态。 */
export function escalateHook(draft: State, hookId: string, novelty: string): HookState {
  const hook = requireLiveHook(draft, hookId);
  const noveltyValue = assertNonEmptyString(novelty, "novelty");
  if (hook.status === "parked") {
    assertActiveBudget(draft);
  }
  hook.status = "escalated";
  recordSurface(draft, hook, noveltyValue);
  return hook;
}

/** 兑现：hook 的承诺以可见后果落地，终态。 */
export function payHook(draft: State, hookId: string, payoff: string): HookState {
  const hook = requireLiveHook(draft, hookId);
  const payoffValue = assertNonEmptyString(payoff, "payoff");
  hook.status = "paid";
  recordSurface(draft, hook, payoffValue);
  return hook;
}

/** 退场：不再兑现，终态。需要理由留痕。 */
export function retireHook(draft: State, hookId: string, reason: string): HookState {
  const reasonValue = assertNonEmptyString(reason, "reason");
  const hook = requireLiveHook(draft, hookId);
  hook.status = "retired";
  hook.lastNovelty = reasonValue;
  return hook;
}

export function countActivePressureHooks(draft: State): number {
  return draft.public.hooks.filter(
    (hook) => hook.status === "active" || hook.status === "escalated",
  ).length;
}

export function formatHookLedger(hooks: readonly HookState[]): string | undefined {
  const live = hooks.filter((hook) => !TERMINAL_STATUSES.includes(hook.status));
  if (live.length === 0) return undefined;
  const entries = live
    .map((hook) => `[${hook.status}] ${hook.id}: ${hook.label}（出现 ${hook.surfaceCount} 次）`)
    .join("；");
  return `悬念账本：${entries}。复现/升级必须经 update_hook 并带 hookId；active+escalated 同时最多 ${MAX_ACTIVE_HOOKS} 条。`;
}

function recordSurface(draft: State, hook: HookState, novelty: string): void {
  hook.lastSurfacedAt = draft.public.clock.currentAt;
  hook.surfaceCount += 1;
  hook.lastNovelty = novelty;
}

function assertActiveBudget(draft: State): void {
  const active = countActivePressureHooks(draft);
  if (active >= MAX_ACTIVE_HOOKS) {
    const labels = draft.public.hooks
      .filter((hook) => hook.status === "active" || hook.status === "escalated")
      .map((hook) => `${hook.id}｜${hook.label}`)
      .join("；");
    throw new Error(
      `active hook 预算已满（${active}/${MAX_ACTIVE_HOOKS}）：${labels}。先 park / pay / retire 一条再引入新压力。`,
    );
  }
}

function requireLiveHook(draft: State, hookId: string): HookState {
  const id = assertNonEmptyString(hookId, "hookId");
  const hook = draft.public.hooks.find((entry) => entry.id === id);
  if (hook === undefined) {
    const known = draft.public.hooks.map((entry) => entry.id).join(", ") || "（无）";
    throw new Error(`hook 不存在: ${id}。已有 hook: ${known}。`);
  }
  if (TERMINAL_STATUSES.includes(hook.status)) {
    throw new Error(`hook ${id} 已是终态（${hook.status}），不能再转换；新悬念请 open 新 hook。`);
  }
  return hook;
}
