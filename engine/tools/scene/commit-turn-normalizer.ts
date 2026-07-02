import type { MemoryEvent } from "../../core/knowledge/memory.ts";
import type { TurnCommitEvent, TurnCommitInput } from "../../core/turn/turn-commit.ts";

import { Type } from "typebox";
import { Compile } from "typebox/compile";

import { parseEconomyEvent } from "../../core/economy/economy-schema.ts";
import { parseMemoryEvent } from "../../core/knowledge/memory-schema.ts";
import { parseSceneEvent } from "../../core/scene/scene-schema.ts";
import { parseTurnTimePolicySchema } from "../../core/turn/turn-time-schema.ts";
import { isRecord, parseTypeBoxValue } from "../../core/utils/typebox-validation.ts";
import { normalizeActorConditionEvent } from "../actor/actor-condition-normalizer.ts";
import { normalizeTrackedItemEvent } from "../inventory/tracked-item-normalizer.ts";

const DEFAULT_SUMMARY = "本轮状态变化。";

const OUTFIT_TURN_SCHEMA = Type.Object({
  actorId: Type.String({ minLength: 1 }),
  outfit: Type.Object({
    label: Type.String({ minLength: 1 }),
    details: Type.String({ minLength: 1 }),
  }),
  reason: Type.String({ minLength: 1 }),
});
const OUTFIT_TURN_VALIDATOR = Compile(OUTFIT_TURN_SCHEMA);
const TURN_EVENT_KINDS = [
  "scene",
  "actor-condition",
  "tracked-item",
  "economy",
  "memory",
  "outfit",
  "hint-secret",
  "hook",
] as const;

export function normalizeTurnCommitInput(params: unknown): TurnCommitInput {
  const input = assertRecord(params, "commit_turn 参数");
  const rawEvents = assertArray(input["events"], "events");
  const time = parseTurnTimePolicySchema(input["time"], "time");
  const summary = normalizeSummary(input["summary"], rawEvents, time.reason);
  return {
    summary,
    time,
    events: rawEvents.map((event) => normalizeTurnCommitEvent(event, summary)),
  };
}

function normalizeTurnCommitEvent(value: unknown, summary: string): TurnCommitEvent {
  const event = assertRecord(value, "events[]");
  const normalizedKind = normalizeTurnEventKind(event["kind"]);
  switch (normalizedKind) {
    case "scene":
      return normalizeSceneTurnEvent(event, summary);
    case "actor-condition":
      return {
        kind: normalizedKind,
        event: normalizeActorConditionEvent(
          withReason(extractDomainEvent(event, "actor-condition.event"), summary),
          summary,
        ),
      };
    case "tracked-item":
      return {
        kind: normalizedKind,
        event: normalizeTrackedItemEvent(
          withReason(extractDomainEvent(event, "tracked-item.event"), summary),
          summary,
        ),
      };
    case "economy":
      return {
        kind: normalizedKind,
        event: parseEconomyEvent(
          withReason(extractDomainEvent(event, "economy.event"), summary),
          "commit_turn economy.event",
        ),
      };
    case "memory":
      return { kind: normalizedKind, event: normalizeMemoryTurnEvent(event) };
    case "outfit":
      return {
        kind: normalizedKind,
        event: parseTypeBoxValue(
          withReason(extractDomainEvent(event, "outfit.event"), summary),
          "commit_turn outfit.event",
          OUTFIT_TURN_VALIDATOR,
        ),
      };
    case "hint-secret":
      return {
        kind: normalizedKind,
        event: extractDomainEvent(event, "hint-secret.event"),
      } as unknown as TurnCommitEvent;
    case "hook":
      return {
        kind: normalizedKind,
        event: extractDomainEvent(event, "hook.event"),
      } as unknown as TurnCommitEvent;
    default:
      throw new Error(
        `非法 commit_turn event.kind: ${formatUnknown(event["kind"])}。允许: ${TURN_EVENT_KINDS.join(" / ")}。`,
      );
  }
}

function normalizeTurnEventKind(rawKind: unknown): TurnCommitEvent["kind"] {
  const kind = normalizeKindText(rawKind);
  for (const candidate of TURN_EVENT_KINDS) {
    if (kind === candidate) {
      return candidate;
    }
  }
  throw new Error(
    `非法 commit_turn event.kind: ${formatUnknown(rawKind)}。允许: ${TURN_EVENT_KINDS.join(" / ")}。`,
  );
}

function normalizeKindText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function extractDomainEvent(
  event: Record<string, unknown>,
  fieldName: string,
): Record<string, unknown> {
  if (isRecord(event["event"])) {
    return event["event"];
  }
  return assertRecord(event, fieldName);
}

function normalizeMemoryTurnEvent(event: Record<string, unknown>): MemoryEvent {
  const payload = extractDomainEvent(event, "memory.event");
  const normalized =
    payload["kind"] === "pin-fact"
      ? { ...payload, sourceEventId: payload["sourceEventId"] ?? null }
      : payload;
  return parseMemoryEvent(normalized, "commit_turn memory.event");
}

function normalizeSceneTurnEvent(event: Record<string, unknown>, summary: string): TurnCommitEvent {
  const payload = normalizeSceneEventPayload(
    withReason(extractDomainEvent(event, "scene.event"), summary),
  );
  return { kind: "scene", event: parseSceneEvent(payload, "commit_turn scene.event") };
}

/**
 * 进 TypeBox parser 之前的宽松预归一化：
 * kind 容错（大小写 / 下划线），resolve-objective 的空白选填字段降级为缺省。
 * 结构与字段校验交给 parseSceneEvent。
 */
function normalizeSceneEventPayload(
  payload: Record<string, unknown> & { reason: string },
): Record<string, unknown> & { reason: string } {
  const kind = normalizeKindText(payload["kind"]);
  if (kind !== "resolve-objective") {
    return { ...payload, kind };
  }
  return {
    ...payload,
    kind,
    objectiveId: normalizeOptionalString(payload["objectiveId"]) ?? undefined,
    objectiveSummary: normalizeOptionalString(payload["objectiveSummary"]) ?? undefined,
  };
}

function normalizeSummary(value: unknown, events: readonly unknown[], timeReason: string): string {
  const explicit = normalizeOptionalString(value);
  if (explicit !== null) {
    return explicit;
  }
  for (const event of events) {
    const reason = findReason(event);
    if (reason !== null) {
      return reason;
    }
  }
  if (timeReason.trim().length > 0) {
    return timeReason;
  }
  return DEFAULT_SUMMARY;
}

function findReason(event: unknown): string | null {
  if (!isRecord(event)) {
    return null;
  }
  const directReason = normalizeOptionalString(event["reason"]);
  if (directReason !== null) {
    return directReason;
  }
  const payload = event["event"];
  if (!isRecord(payload)) {
    return null;
  }
  const payloadReason = normalizeOptionalString(payload["reason"]);
  if (payloadReason !== null) {
    return payloadReason;
  }
  const input = payload["input"];
  if (!isRecord(input)) {
    return null;
  }
  return normalizeOptionalString(input["reason"]);
}

function withReason(
  event: Record<string, unknown>,
  summary: string,
): Record<string, unknown> & {
  reason: string;
} {
  return { ...event, reason: normalizeReason(event["reason"], summary) };
}

function normalizeReason(value: unknown, fallback: string): string {
  return normalizeOptionalString(value) ?? fallback;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组。`);
  }
  return value;
}

function assertRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象。`);
  }
  return value;
}

function formatUnknown(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}
