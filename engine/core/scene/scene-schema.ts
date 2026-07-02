import type { Static } from "typebox";

import type { TypeBoxValidator } from "../utils/typebox-validation.ts";

import { Type } from "typebox";
import { Compile } from "typebox/compile";

import {
  MEMORY_CLAIM_SCHEMA,
} from "../knowledge/memory-schema.ts";
import {
  SCENE_THREAT_SEVERITY_SCHEMA,
  SITUATION_KIND_SCHEMA,
  stringEnumSchema,
} from "../state/state-enum-schemas.ts";
import { LOCATION_STATE_SCHEMA } from "../turn/turn-time-schema.ts";
import { parseTaggedTypeBoxUnion, trimStringsDeep } from "../utils/typebox-validation.ts";

/**
 * Scene 领域事件的工具边界 schema：单一事实来源。
 * SceneEvent 类型由此派生（scene.ts re-export 原名）。
 */
export const SCENE_EVENT_KINDS = [
  "set-location",
  "set-situation",
  "add-objective",
  "resolve-objective",
  "add-threat",
  "clear-threat",
  "scene-presence",
  "begin-beat",
  "complete-beat",
] as const;
const SCENE_EVENT_KIND_SCHEMA = stringEnumSchema(SCENE_EVENT_KINDS);

// ── beat lifecycle sub-kinds ────────────────────────────────────────────────

const SCENE_BEAT_ACTION_POLICY_SCHEMA = Type.Object({
  allowedActions: Type.Optional(Type.Array(Type.String())),
  forbiddenEscalations: Type.Optional(Type.Array(Type.String())),
  completionCriteria: Type.Optional(Type.Array(Type.String())),
  nextBeatHints: Type.Optional(Type.Array(Type.String())),
});

const SCENE_BEAT_PRESENCE_SCHEMA = Type.Object({
  presentActorIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  allyActorIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

const SCENE_BEAT_THREAT_SCHEMA = Type.Object({
  summary: Type.String({ minLength: 1 }),
  severity: SCENE_THREAT_SEVERITY_SCHEMA,
});

const SCENE_BEAT_MEMORY_SCHEMA = Type.Object({
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  consequences: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  claims: Type.Optional(Type.Array(MEMORY_CLAIM_SCHEMA)),
});

const SCENE_BEAT_NEXT_BEAT_SCHEMA = Type.Object({
  title: Type.String({ minLength: 1 }),
  objectives: Type.Array(Type.String({ minLength: 1 })),
  beatId: Type.Optional(Type.String({ minLength: 1 })),
  actionPolicy: Type.Optional(SCENE_BEAT_ACTION_POLICY_SCHEMA),
  threats: Type.Optional(Type.Array(SCENE_BEAT_THREAT_SCHEMA)),
  presence: Type.Optional(SCENE_BEAT_PRESENCE_SCHEMA),
  situation: Type.Optional(SITUATION_KIND_SCHEMA),
});

export const BEGIN_BEAT_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("begin-beat"),
  title: Type.String({ minLength: 1 }),
  objectives: Type.Array(Type.String({ minLength: 1 })),
  purpose: Type.String({ minLength: 1 }),
  beatId: Type.Optional(Type.String({ minLength: 1 })),
  actionPolicy: Type.Optional(SCENE_BEAT_ACTION_POLICY_SCHEMA),
  threats: Type.Optional(Type.Array(SCENE_BEAT_THREAT_SCHEMA)),
  presence: Type.Optional(SCENE_BEAT_PRESENCE_SCHEMA),
  situation: Type.Optional(SITUATION_KIND_SCHEMA),
});

export const COMPLETE_BEAT_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("complete-beat"),
  outcome: Type.String({ minLength: 1 }),
  memory: Type.Optional(SCENE_BEAT_MEMORY_SCHEMA),
  nextBeat: Type.Optional(Type.Union([SCENE_BEAT_NEXT_BEAT_SCHEMA, Type.Null()])),
  presence: Type.Optional(SCENE_BEAT_PRESENCE_SCHEMA),
  situation: Type.Optional(SITUATION_KIND_SCHEMA),
});

// ── legacy sub-kinds ───────────────────────────────────────────────────────

export const STORY_WINDOW_STATE_SCHEMA = Type.Object({
  currentArcId: Type.String({ minLength: 1 }),
  currentBeatId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  allowedActions: Type.Array(Type.String({ minLength: 1 })),
  forbiddenEscalations: Type.Array(Type.String({ minLength: 1 })),
  completionCriteria: Type.Array(Type.String({ minLength: 1 })),
  nextBeatHints: Type.Array(Type.String({ minLength: 1 })),
});

export const SET_LOCATION_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("set-location"),
  location: LOCATION_STATE_SCHEMA,
  reason: Type.String({ minLength: 1 }),
});

export const SET_SITUATION_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("set-situation"),
  situation: SITUATION_KIND_SCHEMA,
  reason: Type.String({ minLength: 1 }),
});

export const ADD_OBJECTIVE_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("add-objective"),
  summary: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1 }),
});

export const RESOLVE_OBJECTIVE_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("resolve-objective"),
  objectiveId: Type.Optional(Type.String({ minLength: 1 })),
  objectiveSummary: Type.Optional(Type.String({ minLength: 1 })),
  reason: Type.String({ minLength: 1 }),
});

export const ADD_THREAT_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("add-threat"),
  summary: Type.String({ minLength: 1 }),
  severity: SCENE_THREAT_SEVERITY_SCHEMA,
  reason: Type.String({ minLength: 1 }),
});

export const CLEAR_THREAT_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("clear-threat"),
  threatId: Type.Optional(Type.String({ minLength: 1 })),
  threatSummary: Type.Optional(Type.String({ minLength: 1 })),
  reason: Type.String({ minLength: 1 }),
});

export const SCENE_PRESENCE_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("scene-presence"),
  presentActorIds: Type.Array(Type.String({ minLength: 1 })),
  allyActorIds: Type.Array(Type.String()),
  reason: Type.String({ minLength: 1 }),
});

export type SceneEvent =
  | Static<typeof SET_LOCATION_EVENT_SCHEMA>
  | Static<typeof SET_SITUATION_EVENT_SCHEMA>
  | Static<typeof ADD_OBJECTIVE_EVENT_SCHEMA>
  | Static<typeof RESOLVE_OBJECTIVE_EVENT_SCHEMA>
  | Static<typeof ADD_THREAT_EVENT_SCHEMA>
  | Static<typeof CLEAR_THREAT_EVENT_SCHEMA>
  | Static<typeof SCENE_PRESENCE_EVENT_SCHEMA>
  | Static<typeof BEGIN_BEAT_EVENT_SCHEMA>
  | Static<typeof COMPLETE_BEAT_EVENT_SCHEMA>;

const SCENE_EVENT_KIND_VALIDATOR = Compile(SCENE_EVENT_KIND_SCHEMA);
const SET_LOCATION_EVENT_VALIDATOR = Compile(SET_LOCATION_EVENT_SCHEMA);
const SET_SITUATION_EVENT_VALIDATOR = Compile(SET_SITUATION_EVENT_SCHEMA);
const ADD_OBJECTIVE_EVENT_VALIDATOR = Compile(ADD_OBJECTIVE_EVENT_SCHEMA);
const RESOLVE_OBJECTIVE_EVENT_VALIDATOR = Compile(RESOLVE_OBJECTIVE_EVENT_SCHEMA);
const ADD_THREAT_EVENT_VALIDATOR = Compile(ADD_THREAT_EVENT_SCHEMA);
const CLEAR_THREAT_EVENT_VALIDATOR = Compile(CLEAR_THREAT_EVENT_SCHEMA);
const SCENE_PRESENCE_EVENT_VALIDATOR = Compile(SCENE_PRESENCE_EVENT_SCHEMA);
const BEGIN_BEAT_EVENT_VALIDATOR = Compile(BEGIN_BEAT_EVENT_SCHEMA);
const COMPLETE_BEAT_EVENT_VALIDATOR = Compile(COMPLETE_BEAT_EVENT_SCHEMA);

const SCENE_EVENT_VARIANT_VALIDATORS = {
  "set-location": SET_LOCATION_EVENT_VALIDATOR,
  "set-situation": SET_SITUATION_EVENT_VALIDATOR,
  "add-objective": ADD_OBJECTIVE_EVENT_VALIDATOR,
  "resolve-objective": RESOLVE_OBJECTIVE_EVENT_VALIDATOR,
  "add-threat": ADD_THREAT_EVENT_VALIDATOR,
  "clear-threat": CLEAR_THREAT_EVENT_VALIDATOR,
  "scene-presence": SCENE_PRESENCE_EVENT_VALIDATOR,
  "begin-beat": BEGIN_BEAT_EVENT_VALIDATOR,
  "complete-beat": COMPLETE_BEAT_EVENT_VALIDATOR,
} satisfies Record<SceneEvent["kind"], TypeBoxValidator<SceneEvent>>;

export function parseSceneEvent(value: unknown, fieldName: string): SceneEvent {
  return parseTaggedTypeBoxUnion<SceneEvent["kind"], SceneEvent>(
    trimStringsDeep(value),
    fieldName,
    "kind",
    SCENE_EVENT_KIND_VALIDATOR,
    SCENE_EVENT_VARIANT_VALIDATORS,
  );
}
