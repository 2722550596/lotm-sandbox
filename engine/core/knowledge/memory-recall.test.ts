import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../state/initial-state.ts";
import { recallMemory } from "./memory-recall.ts";

void test("recallMemory returns all memory when no filters applied", () => {
  const draft = createInitialState();
  draft.public.memory.eventLog.push({
    id: "evt-1",
    time: "2004-01-30T10:00:00.000Z",
    title: "First encounter",
    summary: "Met Rin at school gate",
    consequences: ["alliance formed"],
  });
  draft.public.memory.dailyEvents.push({
    id: "daily-evt-1",
    time: "2004-01-30T18:00:00.000Z",
    eventKind: "shopping",
    title: "Evening shopping",
    summary: "Bought supplies at the market",
  });
  draft.public.memory.pinnedFacts.push({
    id: "fact-2",
    scope: "npc",
    subject: "rin",
    text: "Tohsaka family heir",
    since: "2004-01-30T10:00:00.000Z",
    sourceEventId: "evt-1",
  });

  const result = recallMemory(draft, {});

  // Default fact from createInitialState + our additions
  assert.ok(result.pinnedFacts.length >= 2);
  assert.equal(result.events.length, 1);
  assert.equal(result.dailyEvents.length, 1);
  assert.equal(result.dailyEvents[0]?.eventKind, "shopping");
  assert.ok(result.totalMatches >= 4);
});

void test("recallMemory filters by keywords (OR matching)", () => {
  const draft = createInitialState();
  draft.public.memory.eventLog.push(
    {
      id: "evt-1",
      time: "2004-01-30T10:00:00.000Z",
      title: "School battle",
      summary: "Fought Lancer at school",
      consequences: [],
    },
    {
      id: "evt-2",
      time: "2004-01-30T12:00:00.000Z",
      title: "Church meeting",
      summary: "Met Kotomine at church",
      consequences: [],
    },
  );

  const result = recallMemory(draft, { keywords: ["Lancer", "church"] });

  assert.equal(result.events.length, 2);
});

void test("recallMemory filters by actorId", () => {
  const draft = createInitialState();
  draft.public.memory.pinnedFacts.push(
    {
      id: "fact-1",
      scope: "npc",
      subject: "rin",
      text: "Master of Archer",
      since: "2004-01-30T10:00:00.000Z",
      sourceEventId: null,
    },
    {
      id: "fact-2",
      scope: "npc",
      subject: "sakura",
      text: "Matou family member",
      since: "2004-01-30T10:00:00.000Z",
      sourceEventId: null,
    },
  );

  const result = recallMemory(draft, { actorId: "rin" });

  assert.equal(result.pinnedFacts.length, 1);
  assert.equal(result.pinnedFacts[0]?.subject, "rin");
});

void test("recallMemory filters by scope", () => {
  const draft = createInitialState();
  draft.public.memory.pinnedFacts.push(
    {
      id: "fact-1",
      scope: "world",
      subject: "grail",
      text: "Holy Grail War rules",
      since: "2004-01-30T10:00:00.000Z",
      sourceEventId: null,
    },
    {
      id: "fact-2",
      scope: "npc",
      subject: "rin",
      text: "Tohsaka heir",
      since: "2004-01-30T10:00:00.000Z",
      sourceEventId: null,
    },
  );

  const result = recallMemory(draft, { scope: "world" });

  // Only world-scoped facts (excluding initial setup fact which is 'character')
  assert.ok(result.pinnedFacts.every((fact) => fact.scope === "world"));
});

void test("recallMemory filters by location", () => {
  const draft = createInitialState();
  draft.public.memory.eventLog.push(
    {
      id: "evt-1",
      time: "2004-01-30T10:00:00.000Z",
      title: "Ryuudou gate",
      summary: "Sensed bounded field near Ryuudou Temple",
      consequences: [],
    },
    {
      id: "evt-2",
      time: "2004-01-30T12:00:00.000Z",
      title: "School lunch",
      summary: "Had lunch at Homurahara cafeteria",
      consequences: [],
    },
  );

  const result = recallMemory(draft, { location: "Ryuudou" });

  assert.equal(result.events.length, 1);
  assert.match(result.events[0]?.title ?? "", /Ryuudou/);
});

void test("recallMemory respects limit", () => {
  const draft = createInitialState();
  for (let i = 0; i < 15; i++) {
    draft.public.memory.eventLog.push({
      id: `evt-${i}`,
      time: "2004-01-30T10:00:00.000Z",
      title: `Event ${i}`,
      summary: `Something happened ${i}`,
      consequences: [],
    });
  }

  const result = recallMemory(draft, { limit: 5 });

  assert.equal(result.events.length, 5);
  assert.ok(result.totalMatches >= 15);
});

void test("recallMemory returns empty for no matches", () => {
  const draft = createInitialState();
  const result = recallMemory(draft, { keywords: ["nonexistent_xyz_thing"] });
  assert.equal(result.events.length, 0);
  // pinnedFacts might match 0 too
});
