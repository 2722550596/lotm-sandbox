import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { migrateRawGameState } from "./state-migration.ts";

describe("state migration v1→v2 (offscreenEventLog → undercurrents)", () => {
  function makeRawV1(overrides?: Record<string, unknown>): Record<string, unknown> {
    return {
      meta: { schemaVersion: 1 },
      public: {
        scenario: { title: "test", timeline: "test", premise: "" },
        clock: { currentAt: "2000-01-01T00:00:00.000Z", timezone: "UTC", lastResolvedAt: "2000-01-01T00:00:00.000Z" },
        scene: {
          location: { region: "", site: "", detail: "" },
          situation: "",
          presentActorIds: [],
          objectives: [],
          threats: [],
        },
        actors: {},
        relationshipSignals: [],
        sceneLog: [],
      },
      secrets: {
        actorStates: {},
        hiddenWorldFacts: [],
        secretEventLog: [],
        offscreenEventLog: [],
        factionClocks: [],
        scheduledEvents: [],
        relationshipSignals: [],
        backstageObligations: [],
        backstageReviewLog: [],
        backstagePressure: { consecutiveNoCostTurns: 0 },
        backstagePendingHarvests: [],
        ...overrides,
      },
    };
  }

  test("removes offscreenEventLog and renames factionClocks → undercurrents", () => {
    const raw = makeRawV1({
      offscreenEventLog: [{ id: "e1", lineId: "l1", actorIds: ["a1"], timeRange: { start: "2000-01-01T00:00:00.000Z", end: "2000-01-01T01:00:00.000Z" }, visibility: "secret", summary: "x", consequences: [], futureHooks: [], createdFrom: "gm", pressureType: "social", pressureSlotId: null }],
      factionClocks: [
        { id: "fc1", factionId: "steam-church", label: "蒸汽教会调查", filled: 3, size: 6, visibility: "hidden" },
        { id: "fc2", factionId: "nighthawks", label: "代罚者行动", filled: 6, size: 6, visibility: "leaked" },
      ],
    });
    const result = migrateRawGameState(raw);
    const secrets = result["secrets"] as Record<string, unknown>;

    assert.equal((result["meta"] as Record<string, unknown>)["schemaVersion"], 2);
    assert.equal(secrets["offscreenEventLog"], undefined, "offscreenEventLog should be removed");
    assert.ok(Array.isArray(secrets["undercurrents"]), "undercurrents should exist");
    assert.equal((secrets["undercurrents"] as unknown[]).length, 2);
  });

  test("converts FactionClock fields to Undercurrent correctly", () => {
    const raw = makeRawV1({
      factionClocks: [
        { id: "fc1", factionId: "steam-church", label: "蒸汽教会调查", filled: 3, size: 6, visibility: "hidden" },
      ],
    });
    const result = migrateRawGameState(raw);
    const undercurrents = (result["secrets"] as Record<string, unknown>)["undercurrents"] as Record<string, unknown>[];

    assert.equal(undercurrents[0]?.id, "fc1");
    assert.deepEqual(undercurrents[0]?.actorIds, ["steam-church"]);
    assert.equal(undercurrents[0]?.label, "蒸汽教会调查");
    assert.equal(undercurrents[0]?.filled, 3);
    assert.equal(undercurrents[0]?.size, 6);
    assert.equal(undercurrents[0]?.visibility, "secret");
    assert.equal(undercurrents[0]?.pressureType, "");
    assert.equal(undercurrents[0]?.futureHook, "");
    assert.equal(undercurrents[0]?.lastChangedAt, "");
  });

  test("converts leaked visibility to foreshadowed", () => {
    const raw = makeRawV1({
      factionClocks: [
        { id: "fc1", factionId: "faction-a", label: "test", filled: 0, size: 4, visibility: "leaked" },
      ],
    });
    const result = migrateRawGameState(raw);
    const undercurrents = (result["secrets"] as Record<string, unknown>)["undercurrents"] as Record<string, unknown>[];
    assert.equal(undercurrents[0]?.visibility, "foreshadowed");
  });

  test("handles empty factionClocks array", () => {
    const raw = makeRawV1({ factionClocks: [] });
    const result = migrateRawGameState(raw);
    const undercurrents = (result["secrets"] as Record<string, unknown>)["undercurrents"];
    assert.ok(Array.isArray(undercurrents));
    assert.equal(undercurrents.length, 0);
  });

  test("handles missing factionClocks gracefully", () => {
    const raw = makeRawV1();
    const secrets = raw["secrets"] as Record<string, unknown>;
    delete secrets["factionClocks"];
    const result = migrateRawGameState(raw);
    const undercurrents = (result["secrets"] as Record<string, unknown>)["undercurrents"];
    assert.ok(Array.isArray(undercurrents));
    assert.equal(undercurrents.length, 0);
  });
});