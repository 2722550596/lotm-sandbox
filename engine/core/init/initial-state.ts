import type { HumanActorState, State } from "../state/state.ts";

import { LOTM_EPOCH_ISO, nowIso } from "../state/date-time.ts";
import { CURRENT_STATE_SCHEMA_VERSION } from "../state/state.ts";
import { generateSeed } from "../utils/seeded-rng.ts";

export const PROTAGONIST_ACTOR_ID = "protagonist";

export function createInitialState(protagonistActorId: string = PROTAGONIST_ACTOR_ID): State {
  const now = nowIso();
  const protagonist = createInitialProtagonist(protagonistActorId);
  return {
    meta: {
      schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      rngSeed: generateSeed(),
      rngCounter: 0,
    },
    public: {
      scenario: {
        title: "诡秘之主叙事",
        timeline: "tingen",
        openingMode: "selected",
        premise: "第五纪1349年，鲁恩王国廷根市，玩家角色的身份与卷入方式尚待开局确认。",
        activeRuleSetIds: [
          "lotm-worldview-filter",
          "lotm-judgment-combat",
          "lotm-economy",
          "lotm-sequence-promotion",
        ],
      },
      clock: {
        startedAt: LOTM_EPOCH_ISO,
        currentAt: LOTM_EPOCH_ISO,
        timezone: "UTC",
        lastLongRestAt: null,
      },
      scene: {
        location: {
          region: "鲁恩王国",
          site: "廷根",
          detail: "廷根某地",
          boundary: "normal",
        },
        situation: "daily",
        storyWindow: null,
        presentActorIds: [protagonistActorId],
        objectives: [],
        threats: [],
        lastResolvedAt: LOTM_EPOCH_ISO,
      },
      actors: { [protagonistActorId]: protagonist },
      trackedItems: {},
      protagonistActorId,
      allyActorIds: [],
      economy: {
        accessibleFunds: [
          {
            id: "purse-protagonist-cash",
            ownerActorId: protagonistActorId,
            label: "随身便士",
            amount: 24,
            currencyType: "loen",
            access: "held",
          },
        ],
        debts: [],
      },
      memory: {
        pinnedFacts: [
          {
            id: "fact-opening-identity-unfixed",
            scope: "protagonist",
            subject: protagonistActorId,
            text: "玩家角色身份尚未锁定；不得默认是非凡者、普通人或穿越者。",
            since: LOTM_EPOCH_ISO,
            sourceEventId: null,
          },
        ],
        eventLog: [],
        dailySummaries: [],
        dailyEvents: [],
      },
      turnLog: [],
      obligations: [],
      hooks: [],
      relationshipSignals: [],
      actorImpressions: {},
      pendingDirectionPacket: false,
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
    },
  };
}

function createInitialProtagonist(id: string): HumanActorState {
  return {
    id,
    kind: "human",
    sequence: null,
    identity: {
      publicIdentity: "身份未定的玩家角色",
      background: "开局尚未确认。由初始化或后续记忆事件锁定，不得在叙事中漂移。",
      lockedFacts: [],
      roles: [],
    },
    presentation: {
      canonicalName: "你",
      renderName: "你",
      apparentAge: "未确认",
      outfit: { label: "日常服装", details: "开局尚未细化。" },
      demeanor: "由玩家行动定义。",
    },
    condition: { afflictions: [] },
    inventory: { items: [] },
    abilities: [],
    relationshipToProtagonist: { stance: "self", summary: "玩家本人。" },
  };
}
