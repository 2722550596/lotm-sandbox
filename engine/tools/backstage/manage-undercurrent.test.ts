import assert from "node:assert/strict";
import test from "node:test";

import { getState, resetState } from "../../core/state/state-store.ts";
import { manageUndercurrentTool } from "./manage-undercurrent.ts";

function sessionManager(): unknown {
  return { appendCustomEntry: () => "entry-test" };
}

void test("brew → advance → advance → manifest lifecycle removes undercurrent and opens hook", () => {
  resetState();

  // --- brew ---
  const brewResult = manageUndercurrentTool(
    {
      kind: "brew",
      actorIds: ["protagonist"],
      label: "廷根市的隐秘阴谋",
      size: 3,
      visibility: "secret",
      pressureType: "intrigue",
      futureHook: "隐秘阴谋的真相",
    },
    sessionManager(),
  );
  assert.match(brewResult.content[0]?.text ?? "", /潜流已酿造/);

  const afterBrew = getState();
  assert.equal(afterBrew.secrets.undercurrents.length, 1);
  const uc = afterBrew.secrets.undercurrents[0]!;
  assert.equal(uc.label, "廷根市的隐秘阴谋");
  assert.equal(uc.filled, 0);
  assert.equal(uc.size, 3);
  assert.equal(uc.visibility, "secret");
  assert.equal(uc.futureHook, "隐秘阴谋的真相");

  // --- advance by 1 (not full) ---
  const advance1Result = manageUndercurrentTool(
    { kind: "advance", undercurrentId: uc.id, ticks: 1, reason: "教团成员开始行动" },
    sessionManager(),
  );
  assert.match(advance1Result.content[0]?.text ?? "", /潜流已推进/);
  assert.doesNotMatch(advance1Result.content[0]?.text ?? "", /已填满/);

  const afterAdvance1 = getState();
  const uc1 = afterAdvance1.secrets.undercurrents.find((u) => u.id === uc.id)!;
  assert.equal(uc1.filled, 1);
  assert.equal(uc1.size, 3);

  // --- advance by 2 (becomes full, becameFull=true) ---
  const advance2Result = manageUndercurrentTool(
    { kind: "advance", undercurrentId: uc.id, ticks: 2, reason: "关键人物已就位" },
    sessionManager(),
  );
  assert.match(advance2Result.content[0]?.text ?? "", /潜流已填满/);

  const afterAdvance2 = getState();
  const uc2 = afterAdvance2.secrets.undercurrents.find((u) => u.id === uc.id)!;
  assert.equal(uc2.filled, 3);
  assert.equal(uc2.size, 3);

  // --- manifest (opens hook, removes undercurrent) ---
  const manifestResult = manageUndercurrentTool(
    { kind: "manifest", undercurrentId: uc.id, summary: "极光会成员在廷根市现身" },
    sessionManager(),
  );
  assert.match(manifestResult.content[0]?.text ?? "", /潜流已显现/);

  const afterManifest = getState();
  // Undercurrent removed
  assert.equal(
    afterManifest.secrets.undercurrents.find((u) => u.id === uc.id),
    undefined,
  );
  // Hook created with the futureHook label
  const hook = afterManifest.public.hooks.find((h) => h.label === "隐秘阴谋的真相");
  assert.ok(hook, "manifest should open a hook with the futureHook label");
  assert.equal(hook?.status, "active");
  // Secret event log populated
  assert.ok(
    afterManifest.secrets.secretEventLog.some(
      (e) =>
        e.summary.startsWith("[undercurrent:廷根市的隐秘阴谋]") &&
        e.summary.includes("极光会成员在廷根市现身"),
    ),
  );
});

void test("brew then disrupt removes undercurrent with no hook", () => {
  resetState();

  // --- brew ---
  manageUndercurrentTool(
    {
      kind: "brew",
      actorIds: ["protagonist"],
      label: "蒸汽教会的小动作",
      size: 4,
      visibility: "secret",
      pressureType: "scheming",
      futureHook: "蒸汽教会阴谋",
    },
    sessionManager(),
  );
  const ucId = getState().secrets.undercurrents[0]!.id;

  // --- disrupt ---
  const disruptResult = manageUndercurrentTool(
    { kind: "disrupt", undercurrentId: ucId, reason: "主角意外发现了线索" },
    sessionManager(),
  );
  assert.match(disruptResult.content[0]?.text ?? "", /潜流已被扰乱/);

  const afterDisrupt = getState();
  // Undercurrent removed
  assert.equal(afterDisrupt.secrets.undercurrents.length, 0);
  // No hook opened (disrupt does not call openHook)
  assert.equal(
    afterDisrupt.public.hooks.find((h) => h.label === "蒸汽教会阴谋"),
    undefined,
  );
  // Secret event log records the disruption
  assert.ok(
    afterDisrupt.secrets.secretEventLog.some(
      (e) =>
        e.summary.startsWith("[undercurrent:蒸汽教会的小动作]") &&
        e.summary.includes("主角意外发现了线索"),
    ),
  );
});

void test("brew then subside removes undercurrent with no hook", () => {
  resetState();

  // --- brew ---
  manageUndercurrentTool(
    {
      kind: "brew",
      actorIds: ["protagonist"],
      label: "军方调动的传闻",
      size: 2,
      visibility: "foreshadowed",
      pressureType: "tension",
      futureHook: "军方调动",
    },
    sessionManager(),
  );
  const ucId = getState().secrets.undercurrents[0]!.id;

  // --- subside ---
  const subsideResult = manageUndercurrentTool(
    { kind: "subside", undercurrentId: ucId, reason: "传闻被证实是误报" },
    sessionManager(),
  );
  assert.match(subsideResult.content[0]?.text ?? "", /潜流已平息/);

  const afterSubside = getState();
  // Undercurrent removed
  assert.equal(afterSubside.secrets.undercurrents.length, 0);
  // No hook opened
  assert.equal(
    afterSubside.public.hooks.find((h) => h.label === "军方调动"),
    undefined,
  );
  // Secret event log records the subsidence
  assert.ok(
    afterSubside.secrets.secretEventLog.some(
      (e) =>
        e.summary.startsWith("[undercurrent:军方调动的传闻]") &&
        e.summary.includes("传闻被证实是误报"),
    ),
  );
});

void test("schedule-event then resolve-due cycle", () => {
  resetState();

  // --- schedule-event ---
  const scheduleResult = manageUndercurrentTool(
    { kind: "schedule-event", dueAt: "+2days", summary: "神秘聚会如期举行" },
    sessionManager(),
  );
  assert.match(scheduleResult.content[0]?.text ?? "", /到期义务已登记/);

  const afterSchedule = getState();
  assert.equal(afterSchedule.secrets.scheduledEvents.length, 1);
  const event = afterSchedule.secrets.scheduledEvents[0]!;
  assert.equal(event.summary, "神秘聚会如期举行");
  assert.ok(event.dueAt > "1349-06-28T07:00:00.000Z");

  // --- resolve-due ---
  const resolveResult = manageUndercurrentTool(
    { kind: "resolve-due", eventId: event.id, outcomeSummary: "聚会上出现了神秘人物" },
    sessionManager(),
  );
  assert.match(resolveResult.content[0]?.text ?? "", /到期义务已兑现并移除/);

  const afterResolve = getState();
  // Event removed
  assert.equal(afterResolve.secrets.scheduledEvents.length, 0);
  // Secret event log records the resolution
  assert.ok(
    afterResolve.secrets.secretEventLog.some(
      (e) =>
        e.summary.startsWith("[scheduled:神秘聚会如期举行]") &&
        e.summary.includes("聚会上出现了神秘人物"),
    ),
  );
});

void test("throws for nonexistent undercurrent or scheduled event id", () => {
  resetState();

  // Nonexistent undercurrent — advance
  assert.throws(
    () =>
      manageUndercurrentTool(
        { kind: "advance", undercurrentId: "undercurrent-999", ticks: 1, reason: "测试" },
        sessionManager(),
      ),
    /undercurrent 不存在/,
  );

  // Nonexistent undercurrent — manifest
  assert.throws(
    () =>
      manageUndercurrentTool(
        { kind: "manifest", undercurrentId: "undercurrent-999", summary: "测试" },
        sessionManager(),
      ),
    /undercurrent 不存在/,
  );

  // Nonexistent undercurrent — disrupt
  assert.throws(
    () =>
      manageUndercurrentTool(
        { kind: "disrupt", undercurrentId: "undercurrent-999", reason: "测试" },
        sessionManager(),
      ),
    /undercurrent 不存在/,
  );

  // Nonexistent undercurrent — subside
  assert.throws(
    () =>
      manageUndercurrentTool(
        { kind: "subside", undercurrentId: "undercurrent-999", reason: "测试" },
        sessionManager(),
      ),
    /undercurrent 不存在/,
  );

  // Nonexistent scheduled event — resolve-due
  assert.throws(
    () =>
      manageUndercurrentTool(
        { kind: "resolve-due", eventId: "scheduled-event-999", outcomeSummary: "测试" },
        sessionManager(),
      ),
    /scheduled event 不存在/,
  );

  // Nonexistent scheduled event — extend-due
  assert.throws(
    () =>
      manageUndercurrentTool(
        { kind: "extend-due", eventId: "scheduled-event-999", newDueAt: "+3days", reason: "测试" },
        sessionManager(),
      ),
    /scheduled event 不存在/,
  );
});

void test("throws for unknown kind", () => {
  resetState();

  assert.throws(() => manageUndercurrentTool({ kind: "bogus" }, sessionManager()), /不支持的 kind/);
});
