import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../state/initial-state.ts";
import { recordMemory } from "./memory.ts";

void test("recordMemory stores pinned facts in public scenario memory", () => {
  const draft = createInitialState();

  const result = recordMemory(draft, {
    kind: "pin-fact",
    scope: "protagonist",
    subject: "protagonist",
    text: "玩家确认自己是御主。",
    sourceEventId: null,
    claims: [{ kind: "mundane", statement: "玩家确认自己是御主。", certainty: "confirmed" }],
  });

  const fact = draft.public.memory.pinnedFacts.find((entry) => entry.id === result.factId);
  assert.equal(fact?.text, "玩家确认自己是御主。");
});

void test("recordMemory stores major events with consequences", () => {
  const draft = createInitialState();

  const result = recordMemory(draft, {
    kind: "record-major-event",
    title: "契约成立",
    summary: "玩家与 Saber 缔结契约。",
    consequences: ["玩家成为御主。"],
    claims: [{ kind: "mundane", statement: "玩家与 Saber 缔结契约。", certainty: "confirmed" }],
  });

  const event = draft.public.memory.eventLog.find((entry) => entry.id === result.eventId);
  assert.equal(event?.title, "契约成立");
  assert.deepEqual(event?.consequences, ["玩家成为御主。"]);
});

void test("recordMemory requires structured claims", () => {
  const draft = createInitialState();

  assert.throws(
    () =>
      recordMemory(draft, {
        kind: "record-major-event",
        title: "廷根市教堂确认情报",
        summary: "值夜者确认非凡者在廷根市教堂。",
        consequences: ["非凡者位置已确认。"],
        claims: [],
      }),
    /必须提供 claims/,
  );

  assert.throws(() => {
    const invalidEvent = {
      kind: "record-major-event",
      title: "廷根市教堂确认情报",
      summary: "值夜者确认非凡者在廷根市教堂。",
      consequences: ["非凡者位置已确认。"],
    };
    // @ts-expect-error runtime boundary regression: tool input may omit claims even though TypeScript callers cannot.
    recordMemory(draft, invalidEvent);
  }, /必须提供 claims/);
});

void test("recordMemory accepts missing major event consequences as empty", () => {
  const draft = createInitialState();

  const result = recordMemory(draft, {
    kind: "record-major-event",
    title: "廷根市采购非凡物资",
    summary: "值夜者小队在廷根市商业街采购非凡物资并返回教堂驻地。",
    claims: [
      {
        kind: "mundane",
        statement: "值夜者小队在廷根市商业街购买了非凡物资。",
        certainty: "observed",
      },
    ],
  });

  const event = draft.public.memory.eventLog.find((entry) => entry.id === result.eventId);
  assert.deepEqual(event?.consequences, []);
});

void test("recordMemory rejects non-mundane confirmed claims without evidence", () => {
  const draft = createInitialState();

  assert.throws(
    () =>
      recordMemory(draft, {
        kind: "record-major-event",
        title: "廷根市教堂确认情报",
        summary: "值夜者确认非凡者在廷根市教堂。",
        consequences: ["非凡者位置已确认。"],
        claims: [
          {
            kind: "location",
            statement: "值夜者确认非凡者在廷根市教堂。",
            certainty: "confirmed",
          },
        ],
      }),
    /非 mundane claim 必须提供 evidence/,
  );
});

void test("recordMemory accepts explicitly worded hypotheses", () => {
  const draft = createInitialState();

  const result = recordMemory(draft, {
    kind: "record-major-event",
    title: "关于廷根市教堂的未证实猜测",
    summary: "线人猜测非凡者可能与廷根市教堂有关，但没有证据确认。",
    consequences: ["该猜测未证实，不能作为行动事实。"],
    claims: [
      {
        kind: "location",
        statement: "线人猜测非凡者可能与廷根市教堂有关。",
        certainty: "hypothesis",
      },
    ],
  });

  const event = draft.public.memory.eventLog.find((entry) => entry.id === result.eventId);
  assert.match(event?.summary ?? "", /猜测/);
});

void test("recordMemory rejects hypothesis worded as confirmed fact", () => {
  const draft = createInitialState();

  assert.throws(
    () =>
      recordMemory(draft, {
        kind: "pin-fact",
        scope: "world",
        subject: "廷根市教堂",
        text: "值夜者确认非凡者在廷根市教堂。",
        sourceEventId: null,
        claims: [
          {
            kind: "location",
            statement: "值夜者确认非凡者在廷根市教堂。",
            certainty: "hypothesis",
          },
        ],
      }),
    /不能写成确认事实/,
  );
});

void test("recordMemory daily summary accepts any summary after assertDailySummaryScope removed", () => {
  const draft = createInitialState();

  const result = recordMemory(draft, {
    kind: "record-daily-summary",
    startDate: "2004-01-30T00:00:00.000Z",
    endDate: "2004-01-30T23:59:00.000Z",
    summary: "在廷根市商业街购入两件防污斗篷，花费2400便士。",
  });

  assert.equal(draft.public.memory.dailySummaries[0]?.id, result.dailySummaryId);
});

void test("recordMemory accepts actual daily summaries", () => {
  const draft = createInitialState();

  const result = recordMemory(draft, {
    kind: "record-daily-summary",
    startDate: "2004-01-30T00:00:00.000Z",
    endDate: "2004-01-30T23:59:00.000Z",
    summary: "今日下午在廷根市完成采购并返回教堂驻地休整。",
  });

  assert.equal(draft.public.memory.dailySummaries[0]?.id, result.dailySummaryId);
});

void test("recordMemory records a daily event", () => {
  const draft = createInitialState();

  const result = recordMemory(draft, {
    kind: "record-daily-event",
    eventKind: "shopping",
    title: "采购物资",
    summary: "在廷根市商业街购入两件防污斗篷。",
  });

  const event = draft.public.memory.dailyEvents[0];
  assert.equal(event?.id, result.dailyEventId);
  assert.equal(event?.eventKind, "shopping");
  assert.equal(event?.title, "采购物资");
  assert.equal(event?.summary, "在廷根市商业街购入两件防污斗篷。");
  assert.ok(typeof event?.time === "string");
});

void test("recordMemory daily event does not require claims", () => {
  const draft = createInitialState();

  const result = recordMemory(draft, {
    kind: "record-daily-event",
    eventKind: "observation",
    title: "观察报告",
    summary: "观察到目标在市场中与神秘人接触。",
  });

  assert.ok(result.dailyEventId !== undefined);
  assert.equal(draft.public.memory.dailyEvents.length, 1);
});
