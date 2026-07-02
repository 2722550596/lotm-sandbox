import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../state/initial-state.ts";
import { advanceClock } from "../turn/turn-time.ts";
import {
  advanceUndercurrent,
  brewUndercurrent,
  collectBackstageDueNotices,
  disruptUndercurrent,
  extendScheduledEvent,
  manifestUndercurrent,
  resolveScheduledEvent,
  scheduleEvent,
  subsideUndercurrent,
} from "./undercurrent.ts";

const DUMMY_ACTOR = { actorIds: ["test-actor"], label: "测试潜流", size: 4 };

void test("brewUndercurrent creates with filled=0 and sets lastChangedAt", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "political",
    futureHook: "宫廷内斗浮上台面",
  });
  assert.equal(uc.filled, 0);
  assert.equal(uc.size, 4);
  assert.equal(uc.lastChangedAt, draft.public.clock.currentAt);
  assert.equal(draft.secrets.undercurrents.length, 1);
});

void test("brewUndercurrent stores actorIds and visibility", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    actorIds: ["npc-a", "npc-b"],
    label: "市场恐慌",
    size: 6,
    visibility: "foreshadowed",
    pressureType: "economic",
    futureHook: "",
  });
  assert.deepEqual(uc.actorIds, ["npc-a", "npc-b"]);
  assert.equal(uc.visibility, "foreshadowed");
});

void test("advanceUndercurrent adds ticks", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "social",
    futureHook: "",
  });
  const result = advanceUndercurrent(draft, uc.id, 2, "流言扩散");
  assert.equal(result.clock.filled, 2);
  assert.equal(result.becameFull, false);
  assert.ok(result.clock.lastChangedAt);
});

void test("advanceUndercurrent detects becameFull", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "social",
    futureHook: "",
  });
  advanceUndercurrent(draft, uc.id, 3, "酝酿成熟");
  const result = advanceUndercurrent(draft, uc.id, 1, "临界突破");
  assert.equal(result.clock.filled, 4);
  assert.equal(result.becameFull, true);
});

void test("advanceUndercurrent clamps to size", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "social",
    futureHook: "",
  });
  const result = advanceUndercurrent(draft, uc.id, 10, "过量推进");
  assert.equal(result.clock.filled, 4);
  assert.equal(result.becameFull, true);
});

void test("advanceUndercurrent rejects zero ticks", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "social",
    futureHook: "",
  });
  assert.throws(() => advanceUndercurrent(draft, uc.id, 0, "空推进"), /ticks 必须大于 0/);
});

void test("advanceUndercurrent throws for nonexistent id", () => {
  const draft = createInitialState();
  assert.throws(() => advanceUndercurrent(draft, "missing-id", 1, "测试"), /undercurrent 不存在/);
});

void test("manifestUndercurrent removes entity and creates hook when futureHook is set", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "political",
    futureHook: "宫廷内斗爆发",
  });
  advanceUndercurrent(draft, uc.id, 4, "局势成熟");
  const hooksBefore = draft.public.hooks.length;
  const removed = manifestUndercurrent(draft, uc.id, "内斗爆发，亲王表态");
  assert.equal(removed.id, uc.id);
  // undercurrent 已移除
  assert.equal(draft.secrets.undercurrents.length, 0);
  // hook 被创建
  assert.equal(draft.public.hooks.length, hooksBefore + 1);
  const createdHook = draft.public.hooks.find((h) => h.label === "宫廷内斗爆发");
  assert.ok(createdHook);
  assert.equal(createdHook.status, "active");
  // secretEventLog 有记载
  assert.equal(draft.secrets.secretEventLog.length, 1);
  assert.match(draft.secrets.secretEventLog[0]!.summary, /\[undercurrent:测试潜流\]/);
});

void test("manifestUndercurrent with empty futureHook does not create hook", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "mystery",
    futureHook: "",
  });
  advanceUndercurrent(draft, uc.id, 4, "时机到");
  const hooksBefore = draft.public.hooks.length;
  manifestUndercurrent(draft, uc.id, "自然消散");
  // hook 不会被创建
  assert.equal(draft.public.hooks.length, hooksBefore);
  // 但 secretEventLog 仍有记录
  assert.equal(draft.secrets.secretEventLog.length, 1);
});

void test("disruptUndercurrent removes entity with reason", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "social",
    futureHook: "",
  });
  disruptUndercurrent(draft, uc.id, "被玩家提前破坏");
  assert.equal(draft.secrets.undercurrents.length, 0);
  assert.equal(draft.secrets.secretEventLog.length, 1);
  assert.match(draft.secrets.secretEventLog[0]!.summary, /测试潜流.*提前破坏/);
});

void test("subsideUndercurrent removes entity with reason", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "social",
    futureHook: "",
  });
  subsideUndercurrent(draft, uc.id, "局势自行缓和");
  assert.equal(draft.secrets.undercurrents.length, 0);
  assert.equal(draft.secrets.secretEventLog.length, 1);
  assert.match(draft.secrets.secretEventLog[0]!.summary, /测试潜流.*自行缓和/);
});

void test("scheduleEvent creates future event", () => {
  const draft = createInitialState();
  const event = scheduleEvent(draft, "+1hour", "秘密会议");
  assert.ok(event.id);
  assert.equal(event.summary, "秘密会议");
  // dueAt 应在当前时间之后
  assert.ok(event.dueAt > draft.public.clock.currentAt);
  assert.equal(draft.secrets.scheduledEvents.length, 1);
});

void test("resolveScheduledEvent resolves and logs", () => {
  const draft = createInitialState();
  const event = scheduleEvent(draft, "+1hour", "秘密会议");
  advanceClock(draft, 120, "时间过去两小时");
  const resolved = resolveScheduledEvent(draft, event.id, "会议如期举行，达成秘密协定");
  assert.equal(resolved.id, event.id);
  assert.equal(draft.secrets.scheduledEvents.length, 0);
  assert.equal(draft.secrets.secretEventLog.length, 1);
  assert.match(draft.secrets.secretEventLog[0]!.summary, /\[scheduled:秘密会议\]/);
});

void test("extendScheduledEvent postpones", () => {
  const draft = createInitialState();
  const event = scheduleEvent(draft, "+1hour", "延期测试");
  const originalDue = event.dueAt;
  const extended = extendScheduledEvent(draft, event.id, "+2hours", "需要更多时间准备");
  assert.equal(extended.id, event.id);
  // dueAt 应被推迟
  assert.ok(extended.dueAt > originalDue);
  assert.equal(draft.secrets.scheduledEvents.length, 1);
});

void test("collectBackstageDueNotices detects full undercurrents", () => {
  const draft = createInitialState();
  const uc = brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "social",
    futureHook: "",
  });
  advanceUndercurrent(draft, uc.id, 4, "发展至顶");
  const notices = collectBackstageDueNotices(draft);
  assert.ok(notices.length >= 1);
  assert.match(notices.join(" "), /潜流已填满/);
  assert.match(notices.join(" "), new RegExp(uc.id));
});

void test("collectBackstageDueNotices returns empty when nothing due", () => {
  const draft = createInitialState();
  brewUndercurrent(draft, {
    ...DUMMY_ACTOR,
    visibility: "secret",
    pressureType: "social",
    futureHook: "",
  });
  scheduleEvent(draft, "+1hour", "不重要");
  // 潜流未满，事件未到期 -> 没有通知
  const notices = collectBackstageDueNotices(draft);
  assert.equal(notices.length, 0);
});
