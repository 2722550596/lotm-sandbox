import type { Static, TSchema } from "typebox";

import type { State } from "./state.ts";
import type { TypeBoxValidator } from "../utils/typebox-validation.ts";

import { Type } from "typebox";
import { Compile } from "typebox/compile";

import { normalizeIsoInstant } from "./date-time.ts";
import { STORY_WINDOW_STATE_SCHEMA } from "../scene/scene-schema.ts";
import {
  ACTOR_STANCE_SCHEMA,
  INTENSITY_LEVEL_SCHEMA,
  MEMORY_SCOPE_SCHEMA,
  NARRATIVE_WEIGHT_LEVEL_SCHEMA,
  OPENING_MODE_SCHEMA,
  PATHWAY_ID_SCHEMA,
  PROMOTION_SYSTEM_SCHEMA,
  PURSE_ACCESS_SCHEMA,
  RULE_SET_ID_SCHEMA,
  SCENE_THREAT_SEVERITY_SCHEMA,
  SEQUENCE_RANK_SCHEMA,
  SITUATION_KIND_SCHEMA,
  stringEnumSchema,
  TIMELINE_ID_SCHEMA,
  TIMEZONE_ID_SCHEMA,
  TRACKED_ITEM_CONDITION_SCHEMA,
  TRACKED_ITEM_KIND_SCHEMA,
  TRACKED_ITEM_VISIBILITY_SCHEMA,
} from "./state-enum-schemas.ts";
import { LOCATION_STATE_SCHEMA } from "../turn/turn-time-schema.ts";
import { MEMORY_CLAIM_SCHEMA } from "../knowledge/memory-schema.ts";
import { CURRENCY_TYPE_SCHEMA } from "../economy/economy-schema.ts";
import { isRecord, parseTypeBoxValue, trimStringsDeep } from "../utils/typebox-validation.ts";

const NON_EMPTY_STRING_SCHEMA = Type.String({ minLength: 1 });
const NON_EMPTY_STRING_ARRAY_SCHEMA = Type.Array(NON_EMPTY_STRING_SCHEMA);
const ISO_INSTANT_SCHEMA = Type.String({ minLength: 1 });
const NON_NEGATIVE_INTEGER_SCHEMA = Type.Integer({ minimum: 0 });

function nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

export const STATE_META_SCHEMA = Type.Object({
  schemaVersion: Type.Integer({ minimum: 0 }),
  createdAt: ISO_INSTANT_SCHEMA,
  updatedAt: ISO_INSTANT_SCHEMA,
  rngSeed: Type.Number(),
  rngCounter: Type.Integer({ minimum: 0 }),
});

export const SCENARIO_STATE_SCHEMA = Type.Object({
  title: NON_EMPTY_STRING_SCHEMA,
  timeline: TIMELINE_ID_SCHEMA,
  openingMode: OPENING_MODE_SCHEMA,
  premise: NON_EMPTY_STRING_SCHEMA,
  activeRuleSetIds: Type.Array(RULE_SET_ID_SCHEMA),
});

export const CLOCK_STATE_SCHEMA = Type.Object({
  startedAt: ISO_INSTANT_SCHEMA,
  currentAt: ISO_INSTANT_SCHEMA,
  timezone: TIMEZONE_ID_SCHEMA,
  lastLongRestAt: nullable(ISO_INSTANT_SCHEMA),
});

export const SCENE_OBJECTIVE_STATUSES = ["active", "blocked", "resolved"] as const;
const SCENE_OBJECTIVE_STATUS_SCHEMA = stringEnumSchema(SCENE_OBJECTIVE_STATUSES);

export const SCENE_OBJECTIVE_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  status: SCENE_OBJECTIVE_STATUS_SCHEMA,
});

export const SCENE_THREAT_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  severity: SCENE_THREAT_SEVERITY_SCHEMA,
});

export const SCENE_STATE_SCHEMA = Type.Object({
  location: LOCATION_STATE_SCHEMA,
  situation: SITUATION_KIND_SCHEMA,
  storyWindow: nullable(STORY_WINDOW_STATE_SCHEMA),
  presentActorIds: NON_EMPTY_STRING_ARRAY_SCHEMA,
  objectives: Type.Array(SCENE_OBJECTIVE_SCHEMA),
  threats: Type.Array(SCENE_THREAT_SCHEMA),
  lastResolvedAt: ISO_INSTANT_SCHEMA,
});


const TAG_ENTRY_SCHEMA = Type.Object({
  name: NON_EMPTY_STRING_SCHEMA,
});

const SEQUENCE_STATE_SCHEMA = Type.Object({
  currentSequence: NON_EMPTY_STRING_SCHEMA,
  rank: SEQUENCE_RANK_SCHEMA,
  pathway: PATHWAY_ID_SCHEMA,
  promotionSystem: PROMOTION_SYSTEM_SCHEMA,
  tags: Type.Array(TAG_ENTRY_SCHEMA),
  actingCues: Type.Array(
    Type.Object({
      key: NON_EMPTY_STRING_SCHEMA,
      label: NON_EMPTY_STRING_SCHEMA,
      reason: NON_EMPTY_STRING_SCHEMA,
      recordedAt: ISO_INSTANT_SCHEMA,
      intensity: INTENSITY_LEVEL_SCHEMA,
      narrativeWeight: NARRATIVE_WEIGHT_LEVEL_SCHEMA,
    }),
  ),
});

// ---------------------------------------------------------------------------
// Identity & Presentation
// ---------------------------------------------------------------------------

const IDENTITY_STATE_SCHEMA = Type.Object({
  publicIdentity: NON_EMPTY_STRING_SCHEMA,
  background: NON_EMPTY_STRING_SCHEMA,
  lockedFacts: Type.Array(
    Type.Object({ id: NON_EMPTY_STRING_SCHEMA, text: NON_EMPTY_STRING_SCHEMA }),
  ),
  roles: NON_EMPTY_STRING_ARRAY_SCHEMA,
});

const OUTFIT_STATE_SCHEMA = Type.Object({
  label: NON_EMPTY_STRING_SCHEMA,
  details: NON_EMPTY_STRING_SCHEMA,
});

const PRESENTATION_STATE_SCHEMA = Type.Object({
  canonicalName: NON_EMPTY_STRING_SCHEMA,
  renderName: NON_EMPTY_STRING_SCHEMA,
  apparentAge: NON_EMPTY_STRING_SCHEMA,
  outfit: OUTFIT_STATE_SCHEMA,
  demeanor: NON_EMPTY_STRING_SCHEMA,
});

// ---------------------------------------------------------------------------
// Condition — Afflictions (narrative)
// ---------------------------------------------------------------------------

const AFFLICTION_STATE_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  source: NON_EMPTY_STRING_SCHEMA,
  text: NON_EMPTY_STRING_SCHEMA,
  expectedDuration: nullable(NON_EMPTY_STRING_SCHEMA),
});

const CONDITION_STATE_SCHEMA = Type.Object({
  afflictions: Type.Array(AFFLICTION_STATE_SCHEMA),
});

// ---------------------------------------------------------------------------
// Inventory & Abilities
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inventory — 叙事物品清单
// ---------------------------------------------------------------------------

const INVENTORY_STATE_SCHEMA = Type.Object({
  items: Type.Array(NON_EMPTY_STRING_SCHEMA),
});

const ABILITY_STATE_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  label: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
});


const RELATIONSHIP_STATE_SCHEMA = Type.Object({
  stance: ACTOR_STANCE_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
});

// ---------------------------------------------------------------------------
// Actor Variants
// ---------------------------------------------------------------------------

const ACTOR_BASE_PROPERTIES = {
  id: NON_EMPTY_STRING_SCHEMA,
  sequence: nullable(SEQUENCE_STATE_SCHEMA),

  identity: IDENTITY_STATE_SCHEMA,
  presentation: PRESENTATION_STATE_SCHEMA,
  condition: CONDITION_STATE_SCHEMA,
  inventory: INVENTORY_STATE_SCHEMA,
  abilities: Type.Array(ABILITY_STATE_SCHEMA),
  relationshipToProtagonist: RELATIONSHIP_STATE_SCHEMA,
} as const;

const HUMAN_ACTOR_STATE_SCHEMA = Type.Object({
  ...ACTOR_BASE_PROPERTIES,
  kind: Type.Literal("human"),
});

const BEYONDER_ACTOR_STATE_SCHEMA = Type.Object({
  ...ACTOR_BASE_PROPERTIES,
  kind: Type.Literal("beyonder"),
});

const CREATURE_ACTOR_STATE_SCHEMA = Type.Object({
  ...ACTOR_BASE_PROPERTIES,
  kind: Type.Literal("creature"),
  origin: NON_EMPTY_STRING_SCHEMA,
});

const OTHER_ACTOR_STATE_SCHEMA = Type.Object({
  ...ACTOR_BASE_PROPERTIES,
  kind: Type.Literal("other"),
  nature: NON_EMPTY_STRING_SCHEMA,
});

export const PUBLIC_ACTOR_STATE_SCHEMA = Type.Union([
  HUMAN_ACTOR_STATE_SCHEMA,
  BEYONDER_ACTOR_STATE_SCHEMA,
  CREATURE_ACTOR_STATE_SCHEMA,
  OTHER_ACTOR_STATE_SCHEMA,
]);

// ---------------------------------------------------------------------------
// Tracked Items
// ---------------------------------------------------------------------------

export const TRACKED_ITEM_STATE_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  label: NON_EMPTY_STRING_SCHEMA,
  kind: TRACKED_ITEM_KIND_SCHEMA,
  ownerActorId: nullable(NON_EMPTY_STRING_SCHEMA),
  holderActorId: nullable(NON_EMPTY_STRING_SCHEMA),
  location: nullable(LOCATION_STATE_SCHEMA),
  condition: TRACKED_ITEM_CONDITION_SCHEMA,
  visibility: TRACKED_ITEM_VISIBILITY_SCHEMA,
  notes: NON_EMPTY_STRING_ARRAY_SCHEMA,
});

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

const MONEY_PURSE_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  ownerActorId: NON_EMPTY_STRING_SCHEMA,
  label: NON_EMPTY_STRING_SCHEMA,
  amount: NON_NEGATIVE_INTEGER_SCHEMA,
  currencyType: CURRENCY_TYPE_SCHEMA,
  access: PURSE_ACCESS_SCHEMA,
});

const DEBT_STATE_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  debtorActorId: NON_EMPTY_STRING_SCHEMA,
  creditor: NON_EMPTY_STRING_SCHEMA,
  amount: NON_NEGATIVE_INTEGER_SCHEMA,
  reason: NON_EMPTY_STRING_SCHEMA,
});

const ECONOMY_STATE_SCHEMA = Type.Object({
  accessibleFunds: Type.Array(MONEY_PURSE_SCHEMA),
  debts: Type.Array(DEBT_STATE_SCHEMA),
});

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

const MEMORY_FACT_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  scope: MEMORY_SCOPE_SCHEMA,
  subject: NON_EMPTY_STRING_SCHEMA,
  text: NON_EMPTY_STRING_SCHEMA,
  since: ISO_INSTANT_SCHEMA,
  sourceEventId: nullable(NON_EMPTY_STRING_SCHEMA),
});

const MAJOR_EVENT_MEMORY_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  time: ISO_INSTANT_SCHEMA,
  title: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  consequences: NON_EMPTY_STRING_ARRAY_SCHEMA,
  claims: Type.Optional(Type.Array(MEMORY_CLAIM_SCHEMA)),
});

const DAILY_SUMMARY_MEMORY_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  startDate: ISO_INSTANT_SCHEMA,
  endDate: ISO_INSTANT_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
});

const DAILY_EVENT_KINDS = [
  "mundane",
  "relationship",
  "location",
  "shopping",
  "meeting",
  "travel",
  "observation",
] as const;

const DAILY_EVENT_MEMORY_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  time: ISO_INSTANT_SCHEMA,
  eventKind: stringEnumSchema(DAILY_EVENT_KINDS),
  title: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
});

const CAMPAIGN_MEMORY_SCHEMA = Type.Object({
  pinnedFacts: Type.Array(MEMORY_FACT_SCHEMA),
  eventLog: Type.Array(MAJOR_EVENT_MEMORY_SCHEMA),
  dailySummaries: Type.Array(DAILY_SUMMARY_MEMORY_SCHEMA),
  dailyEvents: Type.Array(DAILY_EVENT_MEMORY_SCHEMA),
});

// ---------------------------------------------------------------------------
// Turn Log
// ---------------------------------------------------------------------------

const TURN_TIME_POLICY_STATE_SCHEMA = Type.Union([
  Type.Object({
    kind: Type.Literal("elapsed"),
    elapsedMinutes: Type.Integer(),
    reason: NON_EMPTY_STRING_SCHEMA,
  }),
  Type.Object({
    kind: Type.Literal("travel"),
    location: LOCATION_STATE_SCHEMA,
    elapsedMinutes: Type.Integer(),
    reason: NON_EMPTY_STRING_SCHEMA,
  }),
]);

const TURN_LOG_ENTRY_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  startedAt: ISO_INSTANT_SCHEMA,
  endedAt: ISO_INSTANT_SCHEMA,
  time: TURN_TIME_POLICY_STATE_SCHEMA,
  eventCount: NON_NEGATIVE_INTEGER_SCHEMA,
  resultCount: NON_NEGATIVE_INTEGER_SCHEMA,
});

// ---------------------------------------------------------------------------
// Obligations & Hooks
// ---------------------------------------------------------------------------

export const TURN_OBLIGATION_KINDS = [
  "scene-objective",
  "scene-threat",
  "actor-condition",
  "memory",
  "reveal-secret",
  "tracked-item",
] as const;

export const HOOK_STATUSES = ["active", "parked", "paid", "escalated", "retired"] as const;

const HOOK_STATE_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  label: NON_EMPTY_STRING_SCHEMA,
  status: stringEnumSchema(HOOK_STATUSES),
  lastSurfacedAt: ISO_INSTANT_SCHEMA,
  surfaceCount: NON_NEGATIVE_INTEGER_SCHEMA,
  lastNovelty: Type.String(),
  relatedSecretId: Type.Optional(NON_EMPTY_STRING_SCHEMA),
});

const TURN_OBLIGATION_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  source: NON_EMPTY_STRING_SCHEMA,
  kind: stringEnumSchema(TURN_OBLIGATION_KINDS),
  summary: NON_EMPTY_STRING_SCHEMA,
  createdAt: ISO_INSTANT_SCHEMA,
});

// ---------------------------------------------------------------------------
// Relationship Signals & Impressions
// ---------------------------------------------------------------------------

export const RELATIONSHIP_SIGNAL_VISIBILITIES = ["player-known", "secret"] as const;
const RELATIONSHIP_SIGNAL_VISIBILITY_SCHEMA = stringEnumSchema(RELATIONSHIP_SIGNAL_VISIBILITIES);

const RELATIONSHIP_SIGNAL_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  actorId: NON_EMPTY_STRING_SCHEMA,
  targetActorId: NON_EMPTY_STRING_SCHEMA,
  signal: NON_EMPTY_STRING_SCHEMA,
  interpretation: NON_EMPTY_STRING_SCHEMA,
  boundary: NON_EMPTY_STRING_SCHEMA,
  sourceEventId: nullable(NON_EMPTY_STRING_SCHEMA),
  visibility: RELATIONSHIP_SIGNAL_VISIBILITY_SCHEMA,
});

const ACTOR_IMPRESSION_SCHEMA = Type.Object({
  actorId: NON_EMPTY_STRING_SCHEMA,
  presence: NON_EMPTY_STRING_SCHEMA,
  actionStyle: NON_EMPTY_STRING_SCHEMA,
  relationshipPosture: NON_EMPTY_STRING_SCHEMA,
  voiceMaterial: Type.String(),
  updatedAt: ISO_INSTANT_SCHEMA,
});

// ---------------------------------------------------------------------------
// Public Game State
// ---------------------------------------------------------------------------

export const PUBLIC_GAME_STATE_SCHEMA = Type.Object({
  scenario: SCENARIO_STATE_SCHEMA,
  clock: CLOCK_STATE_SCHEMA,
  scene: SCENE_STATE_SCHEMA,
  actors: Type.Record(Type.String(), PUBLIC_ACTOR_STATE_SCHEMA),
  trackedItems: Type.Record(Type.String(), TRACKED_ITEM_STATE_SCHEMA),
  protagonistActorId: NON_EMPTY_STRING_SCHEMA,
  allyActorIds: NON_EMPTY_STRING_ARRAY_SCHEMA,
  economy: ECONOMY_STATE_SCHEMA,
  memory: CAMPAIGN_MEMORY_SCHEMA,
  turnLog: Type.Array(TURN_LOG_ENTRY_SCHEMA),
  obligations: Type.Array(TURN_OBLIGATION_SCHEMA),
  hooks: Type.Array(HOOK_STATE_SCHEMA),
  relationshipSignals: Type.Array(RELATIONSHIP_SIGNAL_SCHEMA),
  actorImpressions: Type.Record(Type.String(), ACTOR_IMPRESSION_SCHEMA),
  pendingDirectionPacket: Type.Optional(Type.Boolean()),
});

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export const SECRET_REVEAL_STATES = ["hidden", "foreshadowed", "revealed"] as const;
const SECRET_REVEAL_STATE_SCHEMA = stringEnumSchema(SECRET_REVEAL_STATES);

const STRING_SECRET_SLOT_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  value: NON_EMPTY_STRING_SCHEMA,
  revealState: SECRET_REVEAL_STATE_SCHEMA,
  revealCondition: NON_EMPTY_STRING_SCHEMA,
});

const ACTOR_SECRET_SLOTS_SCHEMA = Type.Object({
  actorId: NON_EMPTY_STRING_SCHEMA,
  beyonderSecrets: Type.Array(STRING_SECRET_SLOT_SCHEMA),
  privateMotives: Type.Array(STRING_SECRET_SLOT_SCHEMA),
  unrevealedAffiliations: Type.Array(STRING_SECRET_SLOT_SCHEMA),
});

const HIDDEN_WORLD_FACT_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  text: NON_EMPTY_STRING_SCHEMA,
  relatedActorIds: NON_EMPTY_STRING_ARRAY_SCHEMA,
  revealCondition: NON_EMPTY_STRING_SCHEMA,
  revealState: SECRET_REVEAL_STATE_SCHEMA,
});

const SECRET_EVENT_MEMORY_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  time: ISO_INSTANT_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  relatedActorIds: NON_EMPTY_STRING_ARRAY_SCHEMA,
});

export const UNDERCURRENT_VISIBILITIES = ["secret", "foreshadowed"] as const;

const UNDERCURRENT_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  actorIds: NON_EMPTY_STRING_ARRAY_SCHEMA,
  label: NON_EMPTY_STRING_SCHEMA,
  filled: NON_NEGATIVE_INTEGER_SCHEMA,
  size: Type.Integer({ minimum: 2, maximum: 12 }),
  visibility: stringEnumSchema(UNDERCURRENT_VISIBILITIES),
  pressureType: NON_EMPTY_STRING_SCHEMA,
  futureHook: NON_EMPTY_STRING_SCHEMA,
  lastChangedAt: ISO_INSTANT_SCHEMA,
});

const SCHEDULED_EVENT_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  dueAt: ISO_INSTANT_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
});

const ACTOR_AGENDA_STATE_SCHEMA = Type.Object({
  actorId: NON_EMPTY_STRING_SCHEMA,
  goal: NON_EMPTY_STRING_SCHEMA,
  fear: NON_EMPTY_STRING_SCHEMA,
  currentAssignment: nullable(NON_EMPTY_STRING_SCHEMA),
  lastIndependentActionAt: nullable(ISO_INSTANT_SCHEMA),
});

const ACTOR_KNOWLEDGE_LENS_SCHEMA = Type.Object({
  actorId: NON_EMPTY_STRING_SCHEMA,
  knows: Type.Array(NON_EMPTY_STRING_SCHEMA),
  suspects: Type.Array(NON_EMPTY_STRING_SCHEMA),
  falseBeliefs: Type.Array(NON_EMPTY_STRING_SCHEMA),
  forbiddenKnowledge: Type.Array(NON_EMPTY_STRING_SCHEMA),
});

const SECRET_ACTOR_STATE_SCHEMA = Type.Object({
  actorId: NON_EMPTY_STRING_SCHEMA,
  secrets: Type.Optional(ACTOR_SECRET_SLOTS_SCHEMA),
  agenda: Type.Optional(ACTOR_AGENDA_STATE_SCHEMA),
  knowledgeLens: Type.Optional(ACTOR_KNOWLEDGE_LENS_SCHEMA),
});

const BACKSTAGE_OBLIGATION_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  trigger: stringEnumSchema(["time-advance", "beat-complete", "no-cost-streak"]),
  summary: NON_EMPTY_STRING_SCHEMA,
  createdAt: ISO_INSTANT_SCHEMA,
});

const BACKSTAGE_PENDING_HARVEST_SCHEMA = Type.Object({
  runId: NON_EMPTY_STRING_SCHEMA,
  lineId: NON_EMPTY_STRING_SCHEMA,
  spawnedAt: ISO_INSTANT_SCHEMA,
});

const BACKSTAGE_REVIEW_ENTRY_SCHEMA = Type.Object({
  id: NON_EMPTY_STRING_SCHEMA,
  obligationId: NON_EMPTY_STRING_SCHEMA,
  outcome: stringEnumSchema(["landed", "no-change", "blocked"]),
  reasonCode: NON_EMPTY_STRING_SCHEMA,
  note: NON_EMPTY_STRING_SCHEMA,
  reviewedAt: ISO_INSTANT_SCHEMA,
});

export const SECRET_GAME_STATE_SCHEMA = Type.Object({
  actorStates: Type.Record(Type.String(), SECRET_ACTOR_STATE_SCHEMA),
  hiddenWorldFacts: Type.Array(HIDDEN_WORLD_FACT_SCHEMA),
  secretEventLog: Type.Array(SECRET_EVENT_MEMORY_SCHEMA),
  undercurrents: Type.Array(UNDERCURRENT_SCHEMA),
  scheduledEvents: Type.Array(SCHEDULED_EVENT_SCHEMA),
  relationshipSignals: Type.Array(RELATIONSHIP_SIGNAL_SCHEMA),
  backstageObligations: Type.Array(BACKSTAGE_OBLIGATION_SCHEMA),
  backstageReviewLog: Type.Array(BACKSTAGE_REVIEW_ENTRY_SCHEMA),
  backstagePressure: Type.Object({
    consecutiveNoCostTurns: Type.Integer({ minimum: 0 }),
  }),
  backstagePendingHarvests: Type.Array(BACKSTAGE_PENDING_HARVEST_SCHEMA),
});

// ---------------------------------------------------------------------------
// Full State Schema
// ---------------------------------------------------------------------------

export const STATE_SCHEMA = Type.Object({
  meta: STATE_META_SCHEMA,
  public: PUBLIC_GAME_STATE_SCHEMA,
  secrets: SECRET_GAME_STATE_SCHEMA,
});

type SchemaState = Static<typeof STATE_SCHEMA>;

type AssertAssignable<T extends U, U> = T;
export type StateSchemaParityCheck = [
  AssertAssignable<SchemaState, State>,
  AssertAssignable<State, SchemaState>,
];

const COMPILED_STATE_VALIDATOR = Compile(STATE_SCHEMA);
const STATE_VALIDATOR: TypeBoxValidator<State> = COMPILED_STATE_VALIDATOR;

export function parseStateSchema(value: unknown): State {
  const prepared = applyDeserializationDefaults(trimStringsDeep(value));
  const state = parseTypeBoxValue<State>(prepared, "状态", STATE_VALIDATOR);
  normalizeStateDatesInPlace(state);
  assertStateInvariants(state);
  return state;
}

function applyDeserializationDefaults(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return value;
}

function normalizeStateDatesInPlace(state: State): void {
  state.meta.createdAt = normalizeIsoInstant(state.meta.createdAt, "meta.createdAt");
  state.meta.updatedAt = normalizeIsoInstant(state.meta.updatedAt, "meta.updatedAt");

  const clock = state.public.clock;
  clock.startedAt = normalizeIsoInstant(clock.startedAt, "clock.startedAt");
  clock.currentAt = normalizeIsoInstant(clock.currentAt, "clock.currentAt");
  if (clock.lastLongRestAt !== null) {
    clock.lastLongRestAt = normalizeIsoInstant(clock.lastLongRestAt, "clock.lastLongRestAt");
  }

  state.public.scene.lastResolvedAt = normalizeIsoInstant(
    state.public.scene.lastResolvedAt,
    "scene.lastResolvedAt",
  );

  for (const [index, entry] of state.public.turnLog.entries()) {
    entry.startedAt = normalizeIsoInstant(entry.startedAt, `turnLog[${index}].startedAt`);
    entry.endedAt = normalizeIsoInstant(entry.endedAt, `turnLog[${index}].endedAt`);
  }

  const memory = state.public.memory;
  for (const fact of memory.pinnedFacts) {
    fact.since = normalizeIsoInstant(fact.since, "memoryFact.since");
  }
  for (const event of memory.eventLog) {
    event.time = normalizeIsoInstant(event.time, "majorEvent.time");
  }
  for (const dailySummary of memory.dailySummaries) {
    dailySummary.startDate = normalizeIsoInstant(dailySummary.startDate, "dailySummary.startDate");
    dailySummary.endDate = normalizeIsoInstant(dailySummary.endDate, "dailySummary.endDate");
  }
  for (const dailyEvent of memory.dailyEvents) {
    dailyEvent.time = normalizeIsoInstant(dailyEvent.time, "dailyEvent.time");
  }

  for (const event of state.secrets.secretEventLog) {
    event.time = normalizeIsoInstant(event.time, "secretEvent.time");
  }

  for (const bundle of Object.values(state.secrets.actorStates)) {
    const agenda = bundle.agenda;
    if (agenda !== undefined && agenda.lastIndependentActionAt !== null) {
      agenda.lastIndependentActionAt = normalizeIsoInstant(
        agenda.lastIndependentActionAt,
        "actorAgenda.lastIndependentActionAt",
      );
    }
  }
}

type ActorRegistry = State["public"]["actors"];

function assertStateInvariants(state: State): void {
  const actors = state.public.actors;
  assertActorRegistryInvariants(actors);
  assertSceneActorReferences(state, actors);
  assertTrackedItemInvariants(state, actors);
  assertEconomyActorReferences(state, actors);
  assertSecretActorStateInvariants(state, actors);
  assertRelationshipSignalInvariants(state, actors);
  assertActorImpressionInvariants(state, actors);
  assertUndercurrentInvariants(state);
}

function assertUndercurrentInvariants(state: State): void {
  for (const clock of state.secrets.undercurrents) {
    if (clock.filled > clock.size) {
      throw new Error(
        `非法 undercurrent ${clock.id}: filled(${clock.filled}) 不能大于 size(${clock.size})。`,
      );
    }
  }
}

function assertActorRegistryInvariants(actors: ActorRegistry): void {
  for (const [actorId, actor] of Object.entries(actors)) {
    if (actor.id !== actorId) {
      throw new Error(`actor registry key ${actorId} 与 actor.id ${actor.id} 不一致。`);
    }
  }
}

function assertSceneActorReferences(state: State, actors: ActorRegistry): void {
  assertActorExists(state.public.protagonistActorId, actors, "protagonistActorId");
  for (const actorId of state.public.allyActorIds) {
    assertActorExists(actorId, actors, "allyActorIds[]");
  }
  for (const actorId of state.public.scene.presentActorIds) {
    assertActorExists(actorId, actors, "scene.presentActorIds[]");
  }
}

function assertTrackedItemInvariants(state: State, actors: ActorRegistry): void {
  for (const [itemId, item] of Object.entries(state.public.trackedItems)) {
    if (item.id !== itemId) {
      throw new Error(`trackedItems key ${itemId} 与 item.id ${item.id} 不一致。`);
    }
    if (item.ownerActorId !== null) {
      assertActorExists(item.ownerActorId, actors, "item.ownerActorId");
    }
    if (item.holderActorId !== null) {
      assertActorExists(item.holderActorId, actors, "item.holderActorId");
    }
  }
}

function assertEconomyActorReferences(state: State, actors: ActorRegistry): void {
  for (const purse of state.public.economy.accessibleFunds) {
    assertActorExists(purse.ownerActorId, actors, "purse.ownerActorId");
  }
  for (const debt of state.public.economy.debts) {
    assertActorExists(debt.debtorActorId, actors, "debt.debtorActorId");
  }
}

function assertSecretActorStateInvariants(state: State, actors: ActorRegistry): void {
  for (const [actorId, bundle] of Object.entries(state.secrets.actorStates)) {
    if (bundle.actorId !== actorId) {
      throw new Error(`actorStates key ${actorId} 与 actorId ${bundle.actorId} 不一致。`);
    }
    assertActorExists(actorId, actors, "actorStates key");
    if (bundle.secrets !== undefined && bundle.secrets.actorId !== actorId) {
      throw new Error(
        `actorStates.${actorId}.secrets.actorId ${bundle.secrets.actorId} 与 key 不一致。`,
      );
    }
    if (bundle.agenda !== undefined && bundle.agenda.actorId !== actorId) {
      throw new Error(
        `actorStates.${actorId}.agenda.actorId ${bundle.agenda.actorId} 与 key 不一致。`,
      );
    }
    if (bundle.knowledgeLens !== undefined && bundle.knowledgeLens.actorId !== actorId) {
      throw new Error(
        `actorStates.${actorId}.knowledgeLens.actorId ${bundle.knowledgeLens.actorId} 与 key 不一致。`,
      );
    }
  }
}

function assertRelationshipSignalInvariants(state: State, actors: ActorRegistry): void {
  const seen = new Set<string>();
  for (const signal of state.public.relationshipSignals) {
    assertRelationshipSignalReferences(signal, actors, "public.relationshipSignals[]");
    if (signal.visibility !== "player-known") {
      throw new Error(`public.relationshipSignals 只能包含 player-known 信号: ${signal.id}。`);
    }
    assertUniqueRelationshipSignalId(signal.id, seen);
  }
  for (const signal of state.secrets.relationshipSignals) {
    assertRelationshipSignalReferences(signal, actors, "secrets.relationshipSignals[]");
    if (signal.visibility !== "secret") {
      throw new Error(`secrets.relationshipSignals 只能包含 secret 信号: ${signal.id}。`);
    }
    assertUniqueRelationshipSignalId(signal.id, seen);
  }
}

function assertRelationshipSignalReferences(
  signal: State["public"]["relationshipSignals"][number],
  actors: ActorRegistry,
  fieldName: string,
): void {
  assertActorExists(signal.actorId, actors, `${fieldName}.actorId`);
  assertActorExists(signal.targetActorId, actors, `${fieldName}.targetActorId`);
}

function assertUniqueRelationshipSignalId(id: string, seen: Set<string>): void {
  if (seen.has(id)) {
    throw new Error(`重复 relationship signal id: ${id}。`);
  }
  seen.add(id);
}

function assertActorImpressionInvariants(state: State, actors: ActorRegistry): void {
  for (const [actorId, impression] of Object.entries(state.public.actorImpressions)) {
    if (impression.actorId !== actorId) {
      throw new Error(`actorImpressions key ${actorId} 与 actorId ${impression.actorId} 不一致。`);
    }
    assertActorExists(actorId, actors, "actorImpressions key");
  }
}

function assertActorExists(actorId: string, actors: ActorRegistry, fieldName: string): void {
  if (actors[actorId] === undefined) {
    throw new Error(`非法${fieldName}: actor ${actorId} 不存在。`);
  }
}
