import type { Static } from "typebox";

import type { TurnTimePolicy } from "../state/state.ts";
import type { TypeBoxValidator } from "../utils/typebox-validation.ts";

import { Type } from "typebox";
import { Compile } from "typebox/compile";

import { MEMORY_CLAIM_SCHEMA } from "../knowledge/memory-schema.ts";
import {
  SCENE_THREAT_SEVERITY_SCHEMA,
  SITUATION_KIND_SCHEMA,
  stringEnumSchema,
} from "../state/state-enum-schemas.ts";
import { parseTurnTimePolicySchema } from "../turn/turn-time-schema.ts";
import { parseTaggedTypeBoxUnion, trimStringsDeep } from "../utils/typebox-validation.ts";

/**
 * Scene Beat lifecycle schema：formerly progress_scene_beat tool schema.
 * Now part of commit_turn scene events (begin-beat/complete-beat sub-kinds),
 * but kept here for SceneBeatInput / SceneBeatProgressResult type derivation.
 */
const TURN_TIME_DELEGATED_SCHEMA = Type.Unsafe<TurnTimePolicy>({});

export const SCENE_BEAT_ACTION_POLICY_SCHEMA = Type.Object({
  allowedActions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  forbiddenEscalations: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  completionCriteria: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  nextBeatHints: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export type SceneBeatActionPolicy = Static<typeof SCENE_BEAT_ACTION_POLICY_SCHEMA>;

export const SCENE_BEAT_PRESENCE_INPUT_SCHEMA = Type.Object({
  presentActorIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  allyActorIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export type SceneBeatPresenceInput = Static<typeof SCENE_BEAT_PRESENCE_INPUT_SCHEMA>;

export const SCENE_BEAT_THREAT_INPUT_SCHEMA = Type.Object({
  summary: Type.String({ minLength: 1 }),
  severity: SCENE_THREAT_SEVERITY_SCHEMA,
});
export type SceneBeatThreatInput = Static<typeof SCENE_BEAT_THREAT_INPUT_SCHEMA>;

export const SCENE_BEAT_MEMORY_INPUT_SCHEMA = Type.Object({
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  consequences: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  claims: Type.Optional(Type.Array(MEMORY_CLAIM_SCHEMA)),
});
export type SceneBeatMemoryInput = Static<typeof SCENE_BEAT_MEMORY_INPUT_SCHEMA>;

export const SCENE_BEAT_NEXT_BEAT_INPUT_SCHEMA = Type.Object({
  title: Type.String({ minLength: 1 }),
  objectives: Type.Array(Type.String({ minLength: 1 })),
  beatId: Type.Optional(Type.String({ minLength: 1 })),
  actionPolicy: Type.Optional(SCENE_BEAT_ACTION_POLICY_SCHEMA),
  threats: Type.Optional(Type.Array(SCENE_BEAT_THREAT_INPUT_SCHEMA)),
  presence: Type.Optional(SCENE_BEAT_PRESENCE_INPUT_SCHEMA),
  situation: Type.Optional(SITUATION_KIND_SCHEMA),
});
export type SceneBeatNextBeatInput = Static<typeof SCENE_BEAT_NEXT_BEAT_INPUT_SCHEMA>;

export const PROGRESS_SCENE_BEAT_KINDS = ["begin", "complete"] as const;
const PROGRESS_SCENE_BEAT_KIND_SCHEMA = stringEnumSchema(PROGRESS_SCENE_BEAT_KINDS);

export const SCENE_BEAT_BEGIN_INPUT_SCHEMA = Type.Object({
  kind: Type.Literal("begin"),
  title: Type.String({ minLength: 1 }),
  objectives: Type.Array(Type.String({ minLength: 1 })),
  purpose: Type.String({ minLength: 1 }),
  time: TURN_TIME_DELEGATED_SCHEMA,
  beatId: Type.Optional(Type.String({ minLength: 1 })),
  actionPolicy: Type.Optional(SCENE_BEAT_ACTION_POLICY_SCHEMA),
  threats: Type.Optional(Type.Array(SCENE_BEAT_THREAT_INPUT_SCHEMA)),
  presence: Type.Optional(SCENE_BEAT_PRESENCE_INPUT_SCHEMA),
  situation: Type.Optional(SITUATION_KIND_SCHEMA),
});
export type SceneBeatBeginInput = Static<typeof SCENE_BEAT_BEGIN_INPUT_SCHEMA>;

export const SCENE_BEAT_COMPLETE_INPUT_SCHEMA = Type.Object({
  kind: Type.Literal("complete"),
  outcome: Type.String({ minLength: 1 }),
  time: TURN_TIME_DELEGATED_SCHEMA,
  memory: Type.Optional(SCENE_BEAT_MEMORY_INPUT_SCHEMA),
  nextBeat: Type.Optional(Type.Union([SCENE_BEAT_NEXT_BEAT_INPUT_SCHEMA, Type.Null()])),
  presence: Type.Optional(SCENE_BEAT_PRESENCE_INPUT_SCHEMA),
  situation: Type.Optional(SITUATION_KIND_SCHEMA),
});
export type SceneBeatCompleteInput = Static<typeof SCENE_BEAT_COMPLETE_INPUT_SCHEMA>;

export type SceneBeatProgressInput = SceneBeatBeginInput | SceneBeatCompleteInput;

const PROGRESS_SCENE_BEAT_KIND_VALIDATOR = Compile(PROGRESS_SCENE_BEAT_KIND_SCHEMA);
const SCENE_BEAT_BEGIN_INPUT_VALIDATOR = Compile(SCENE_BEAT_BEGIN_INPUT_SCHEMA);
const SCENE_BEAT_COMPLETE_INPUT_VALIDATOR = Compile(SCENE_BEAT_COMPLETE_INPUT_SCHEMA);

// Compile 必须在独立常量上调用（satisfies 上下文会干扰泛型推导）。
const PROGRESS_SCENE_BEAT_VARIANT_VALIDATORS = {
  begin: SCENE_BEAT_BEGIN_INPUT_VALIDATOR,
  complete: SCENE_BEAT_COMPLETE_INPUT_VALIDATOR,
} satisfies Record<SceneBeatProgressInput["kind"], TypeBoxValidator<SceneBeatProgressInput>>;

export function parseSceneBeatProgressInput(
  value: unknown,
  fieldName: string,
): SceneBeatProgressInput {
  const input = parseTaggedTypeBoxUnion<SceneBeatProgressInput["kind"], SceneBeatProgressInput>(
    trimStringsDeep(value),
    fieldName,
    "kind",
    PROGRESS_SCENE_BEAT_KIND_VALIDATOR,
    PROGRESS_SCENE_BEAT_VARIANT_VALIDATORS,
  );
  const time = parseTurnTimePolicySchema(input.time, `${fieldName}.time`);
  return input.kind === "begin" ? { ...input, time } : { ...input, time };
}
