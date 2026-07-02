import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../state/initial-state.ts";
import { advanceClock } from "../turn/turn-time.ts";
import {
  countActivePressureHooks,
  escalateHook,
  formatHookLedger,
  openHook,
  parkHook,
  payHook,
  retireHook,
  surfaceHook,
} from "./hooks.ts";

void test("openHook registers an active hook with one appearance", () => {
  const draft = createInitialState();
  const hook = openHook(draft, "深夜教堂方向传来的钟声");
  assert.equal(hook.status, "active");
  assert.equal(hook.surfaceCount, 1);
  assert.equal(draft.public.hooks.length, 1);
});

void test("active budget rejects a sixth pressure hook, parking frees the slot", () => {
  const draft = createInitialState();
  openHook(draft, "悬念一");
  openHook(draft, "悬念二");
  openHook(draft, "悬念三");
  openHook(draft, "悬念四");
  openHook(draft, "悬念五");
  assert.throws(() => openHook(draft, "悬念六"), /active hook 预算已满/);

  // park 一条释放预算
  const second = draft.public.hooks.find((h) => h.label === "悬念二")!;
  parkHook(draft, second.id, "玩家选择回家休整");
  assert.equal(countActivePressureHooks(draft), 4);
  openHook(draft, "悬念六");
  assert.equal(countActivePressureHooks(draft), 5);
});

void test("surfacing a parked hook requires novelty, reactivates, and bumps the count", () => {
  const draft = createInitialState();
  const hook = openHook(draft, "新闻里的连环昏迷事件");
  parkHook(draft, hook.id, "玩家无视");
  advanceClock(draft, 60, "过了一小时");

  assert.throws(() => surfaceHook(draft, hook.id, ""), /novelty/);

  const surfaced = surfaceHook(draft, hook.id, "昏迷者名单里出现了同校学生");
  assert.equal(surfaced.status, "active");
});

void test("surfacing a parked hook when the budget is full is rejected", () => {
  const draft = createInitialState();
  const parked = openHook(draft, "旧悬念");
  parkHook(draft, parked.id, "暂时退后");
  openHook(draft, "压力一");
  openHook(draft, "压力二");
  openHook(draft, "压力三");
  openHook(draft, "压力四");
  openHook(draft, "压力五");
  assert.throws(() => surfaceHook(draft, parked.id, "带着新信息回归"), /active hook 预算已满/);
});

void test("pay and retire are terminal", () => {
  const draft = createInitialState();
  const hook = openHook(draft, "监视者的视线");
  payHook(draft, hook.id, "监视者现身：是教会的代行者");
  assert.equal(hook.status, "paid");
  assert.throws(() => surfaceHook(draft, hook.id, "再次出现"), /终态/);

  const other = openHook(draft, "次要悬念");
  retireHook(draft, other.id, "线索已并入主线");
  assert.equal(other.status, "retired");
  assert.throws(() => parkHook(draft, other.id, "x"), /终态/);
});

void test("escalate counts as a surface and records novelty", () => {
  const draft = createInitialState();
  const hook = openHook(draft, "魔力枯竭的征兆");
  const escalated = escalateHook(draft, hook.id, "枯竭范围扩大到整条街区，出现昏迷者");
  assert.equal(escalated.status, "escalated");
  assert.equal(escalated.surfaceCount, 2);
});

void test("formatHookLedger lists live hooks only", () => {
  const draft = createInitialState();
  assert.equal(formatHookLedger(draft.public.hooks), undefined);

  const a = openHook(draft, "悬念A");
  const b = openHook(draft, "悬念B");
  payHook(draft, b.id, "已兑现");
  const ledger = formatHookLedger(draft.public.hooks) ?? "";
  assert.match(ledger, /悬念A/);
  assert.doesNotMatch(ledger, /悬念B/);
  assert.match(ledger, new RegExp(`active.*${a.label}`));
});
