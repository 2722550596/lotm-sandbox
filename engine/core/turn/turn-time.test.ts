import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../state/initial-state.ts";
import { advanceClock, applyTurnTime } from "./turn-time.ts";

void test("advanceClock advances currentAt by specified minutes", () => {
  const draft = createInitialState();
  const before = draft.public.clock.currentAt;

  advanceClock(draft, 30, "测试推进");

  const after = draft.public.clock.currentAt;
  assert.ok(after > before);
  assert.equal(after, "1349-06-28T07:30:00.000Z");
});

void test("advanceClock updates lastResolvedAt", () => {
  const draft = createInitialState();

  advanceClock(draft, 60, "测试推进");

  assert.equal(draft.public.scene.lastResolvedAt, "1349-06-28T08:00:00.000Z");
});

void test("advanceClock rejects empty reason", () => {
  const draft = createInitialState();

  assert.throws(() => advanceClock(draft, 10, ""), /advanceClock 必须提供 reason/);
  assert.throws(() => advanceClock(draft, 10, "  "), /advanceClock 必须提供 reason/);
});

void test("advanceClock rejects negative minutes", () => {
  const draft = createInitialState();

  assert.throws(() => advanceClock(draft, -5, "倒退"), /elapsedMinutes/);
});

void test("applyTurnTime with elapsed advances clock", () => {
  const draft = createInitialState();

  const result = applyTurnTime(draft, {
    kind: "elapsed",
    elapsedMinutes: 15,
    reason: "简短对话",
  });

  assert.match(result.message, /时间已推进/);
  assert.equal(draft.public.clock.currentAt, "1349-06-28T07:15:00.000Z");
});

void test("applyTurnTime with travel updates location and time", () => {
  const draft = createInitialState();

  const result = applyTurnTime(draft, {
    kind: "travel",
    elapsedMinutes: 120,
    reason: "前往下城区",
    location: { region: "贝克兰德", site: "下城区", detail: "桥区", boundary: "normal" },
  });

  assert.match(result.message, /地点已更新/);
  assert.equal(draft.public.clock.currentAt, "1349-06-28T09:00:00.000Z");
  assert.equal(draft.public.scene.location.region, "贝克兰德");
  assert.equal(draft.public.scene.location.site, "下城区");
});

void test("applyTurnTime rejects empty reason", () => {
  const draft = createInitialState();

  assert.throws(
    () => applyTurnTime(draft, { kind: "elapsed", elapsedMinutes: 1, reason: "" }),
    /reason/,
  );
});
