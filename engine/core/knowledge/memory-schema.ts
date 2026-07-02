import type { Static } from "typebox";

import type { TypeBoxValidator } from "../utils/typebox-validation.ts";

import { Type } from "typebox";
import { Compile } from "typebox/compile";

import { MEMORY_SCOPE_SCHEMA, stringEnumSchema } from "../state/state-enum-schemas.ts";
import { parseTaggedTypeBoxUnion, trimStringsDeep } from "../utils/typebox-validation.ts";

/**
 * Memory 领域事件的工具边界 schema：单一事实来源。
 * MemoryEvent / MemoryClaim 等类型由此派生（memory.ts re-export 原名）。
 *
 * claims 故意保持 Optional：缺失/空数组时由引擎 validateClaims 抛出
 * 更具指导性的领域报错（“用结构化 claim 表达……普通事实用 kind=mundane”）。
 */
export const MEMORY_CERTAINTIES = [
  "observed",
  "confirmed",
  "inferred",
  "rumor",
  "hypothesis",
] as const;
export const MEMORY_CERTAINTY_SCHEMA = stringEnumSchema(MEMORY_CERTAINTIES);
export type MemoryCertainty = Static<typeof MEMORY_CERTAINTY_SCHEMA>;

export const MEMORY_CLAIM_KINDS = [
  "mundane",
  "identity",
  "location",
  "affiliation",
  "motive",
  "ability",
  "resource",
  "relationship",
  "event-cause",
  "world-fact",
] as const;
export const MEMORY_CLAIM_KIND_SCHEMA = stringEnumSchema(MEMORY_CLAIM_KINDS);
export type MemoryClaimKind = Static<typeof MEMORY_CLAIM_KIND_SCHEMA>;

export const DAILY_EVENT_KINDS = [
  "mundane",
  "relationship",
  "location",
  "shopping",
  "meeting",
  "travel",
  "observation",
] as const;

export type DailyEventKind = (typeof DAILY_EVENT_KINDS)[number];

export const MEMORY_CLAIM_SCHEMA = Type.Object({
  kind: MEMORY_CLAIM_KIND_SCHEMA,
  statement: Type.String({ minLength: 1 }),
  certainty: MEMORY_CERTAINTY_SCHEMA,
  subjectId: Type.Optional(Type.String({ minLength: 1 })),
  relatedSecretSlotIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  evidence: Type.Optional(Type.String({ minLength: 1 })),
});
export type MemoryClaim = Static<typeof MEMORY_CLAIM_SCHEMA>;

export const MEMORY_EVENT_KINDS = [
  "pin-fact",
  "record-major-event",
  "record-daily-summary",
  "record-daily-event",
] as const;
const MEMORY_EVENT_KIND_SCHEMA = stringEnumSchema(MEMORY_EVENT_KINDS);

export const PIN_FACT_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("pin-fact"),
  scope: MEMORY_SCOPE_SCHEMA,
  subject: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1 }),
  sourceEventId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  claims: Type.Optional(Type.Array(MEMORY_CLAIM_SCHEMA)),
});

export const RECORD_DAILY_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("record-daily-event"),
  eventKind: stringEnumSchema(DAILY_EVENT_KINDS),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
});

export const RECORD_MAJOR_EVENT_SCHEMA = Type.Object({
  kind: Type.Literal("record-major-event"),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  consequences: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  claims: Type.Optional(Type.Array(MEMORY_CLAIM_SCHEMA)),
});

export const RECORD_DAILY_SUMMARY_SCHEMA = Type.Object({
  kind: Type.Literal("record-daily-summary"),
  startDate: Type.String({ minLength: 1 }),
  endDate: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
});

export type MemoryEvent =
  | Static<typeof PIN_FACT_EVENT_SCHEMA>
  | Static<typeof RECORD_DAILY_EVENT_SCHEMA>
  | Static<typeof RECORD_MAJOR_EVENT_SCHEMA>
  | Static<typeof RECORD_DAILY_SUMMARY_SCHEMA>;

const MEMORY_EVENT_KIND_VALIDATOR = Compile(MEMORY_EVENT_KIND_SCHEMA);
const PIN_FACT_EVENT_VALIDATOR = Compile(PIN_FACT_EVENT_SCHEMA);
const RECORD_MAJOR_EVENT_VALIDATOR = Compile(RECORD_MAJOR_EVENT_SCHEMA);
const RECORD_DAILY_SUMMARY_VALIDATOR = Compile(RECORD_DAILY_SUMMARY_SCHEMA);

// Compile 必须在独立常量上调用（satisfies 上下文会干扰泛型推导）。
const RECORD_DAILY_EVENT_VALIDATOR = Compile(RECORD_DAILY_EVENT_SCHEMA);
const MEMORY_EVENT_VARIANT_VALIDATORS = {
  "pin-fact": PIN_FACT_EVENT_VALIDATOR,
  "record-daily-event": RECORD_DAILY_EVENT_VALIDATOR,
  "record-major-event": RECORD_MAJOR_EVENT_VALIDATOR,
  "record-daily-summary": RECORD_DAILY_SUMMARY_VALIDATOR,
} satisfies Record<MemoryEvent["kind"], TypeBoxValidator<MemoryEvent>>;

export function parseMemoryEvent(value: unknown, fieldName: string): MemoryEvent {
  return parseTaggedTypeBoxUnion<MemoryEvent["kind"], MemoryEvent>(
    trimStringsDeep(value),
    fieldName,
    "kind",
    MEMORY_EVENT_KIND_VALIDATOR,
    MEMORY_EVENT_VARIANT_VALIDATORS,
  );
}
