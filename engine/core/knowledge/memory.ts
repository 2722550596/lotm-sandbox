import type {
  DailySummaryMemoryId,
  MajorEventMemoryId,
  MemoryFactId,
  SecretSlot,
  State,
} from "../state/state.ts";
import type { MemoryClaim, MemoryEvent } from "./memory-schema.ts";

import { allActorSecretSlots } from "../actor/secret-actor-state.ts";
import { settleOldestObligation } from "../ledger/obligations.ts";
import { resolveRelativeTime } from "../state/date-time.ts";
import { createId } from "../utils/ids.ts";
import { assertIsoDateString, assertNonEmptyString } from "../utils/typebox-validation.ts";

export type {
  MemoryCertainty,
  MemoryClaim,
  MemoryClaimKind,
  MemoryEvent,
} from "./memory-schema.ts";

export interface MemoryEventResult {
  factId?: MemoryFactId;
  eventId?: MajorEventMemoryId;
  dailySummaryId?: DailySummaryMemoryId;
}

export function recordMemory(draft: State, event: MemoryEvent): MemoryEventResult {
  const result = applyMemoryEvent(draft, event);
  settleOldestObligation(draft, ["memory"]);
  return result;
}

function applyMemoryEvent(draft: State, event: MemoryEvent): MemoryEventResult {
  switch (event.kind) {
    case "pin-fact":
      return recordPinnedFact(draft, event);
    case "record-major-event":
      return recordMajorEvent(draft, event);
    case "record-daily-summary":
      return recordDailySummary(draft, event);
    default:
      throw new Error("unreachable memory event kind");
  }
}

function recordPinnedFact(
  draft: State,
  event: Extract<MemoryEvent, { kind: "pin-fact" }>,
): MemoryEventResult {
  validateClaims(draft, event.claims, event.kind);
  const id = createId(draft, "fact");
  draft.public.memory.pinnedFacts.push({
    id,
    scope: event.scope,
    subject: assertNonEmptyString(event.subject, "subject"),
    text: assertNonEmptyString(event.text, "text"),
    since: draft.public.clock.currentAt,
    sourceEventId:
      event.sourceEventId === null
        ? null
        : assertNonEmptyString(event.sourceEventId, "sourceEventId"),
  });
  return { factId: id };
}

function recordMajorEvent(
  draft: State,
  event: Extract<MemoryEvent, { kind: "record-major-event" }>,
): MemoryEventResult {
  validateClaims(draft, event.claims, event.kind);
  const id = createId(draft, "event");
  draft.public.memory.eventLog.push({
    id,
    time: draft.public.clock.currentAt,
    title: assertNonEmptyString(event.title, "title"),
    summary: assertNonEmptyString(event.summary, "summary"),
    consequences: normalizeConsequences(event.consequences),
    claims: event.claims ? [...event.claims] : undefined,
  });
  return { eventId: id };
}

function normalizeConsequences(consequences: readonly string[] | undefined): string[] {
  if (consequences === undefined) {
    return [];
  }
  return consequences.map((consequence) => assertNonEmptyString(consequence, "consequences[]"));
}

function validateClaims(
  draft: State,
  claims: readonly MemoryClaim[] | undefined,
  eventKind: string,
): void {
  // pin-fact 和 daily-summary 允许不传 claims
  if (eventKind !== "record-major-event" && (claims === undefined || claims.length === 0)) {
    return;
  }
  // record-major-event 必须带 claims
  if (claims === undefined || claims.length === 0) {
    throw new Error(
      "record-major-event 必须提供 claims；用结构化 claim 表达 public memory 的事实类型、确定性和证据。普通事实用 kind=mundane。",
    );
  }
  const secretSlots = allActorSecretSlots(draft.secrets);
  for (const claim of claims) {
    validateClaim(claim, secretSlots);
  }
}

type ClaimSecretSlots = Readonly<{
  beyonderSecrets: SecretSlot<string>[];
  privateMotives: SecretSlot<string>[];
  unrevealedAffiliations: SecretSlot<string>[];
}>;

function validateClaim(claim: MemoryClaim, actorSecrets: readonly ClaimSecretSlots[]): void {
  assertNonEmptyString(claim.statement, "claim.statement");
  if (claim.kind === "mundane") {
    return;
  }

  const secretSlots = findRelatedSecretSlots(claim, actorSecrets);
  if (claim.certainty === "hypothesis" || claim.certainty === "rumor") {
    assertUncertainWording(claim.statement);
    return;
  }

  if (secretSlots.some((slot) => slot.revealState !== "revealed")) {
    throw new Error(
      "公开记忆不能把未揭示 secret 写成 confirmed/observed/inferred claim；请先用 reveal_secret，或改为 certainty=hypothesis/rumor 并使用不确定措辞。",
    );
  }

  if (secretSlots.length === 0 && claim.evidence === undefined) {
    throw new Error(
      "非 mundane claim 必须提供 evidence 或 relatedSecretSlotIds；公开记忆需要可审计证据。",
    );
  }
}

function findRelatedSecretSlots(
  claim: MemoryClaim,
  actorSecrets: readonly ClaimSecretSlots[],
): SecretSlot<unknown>[] {
  const relatedIds = claim.relatedSecretSlotIds ?? [];
  if (relatedIds.length === 0) {
    return [];
  }

  const allSlots = actorSecrets.flatMap((slots) => [
    ...slots.beyonderSecrets,
    ...slots.privateMotives,
    ...slots.unrevealedAffiliations,
  ]);
  return relatedIds.map((slotId) => {
    const slot = allSlots.find((entry) => entry?.id === slotId);
    if (slot === undefined) {
      throw new Error(`relatedSecretSlotId 不存在: ${slotId}`);
    }
    return slot;
  });
}

function assertUncertainWording(statement: string): void {
  if (/[确认確定断定]/u.test(statement) && !/没有证据确认|未确认|不能确认/u.test(statement)) {
    throw new Error("hypothesis/rumor claim 不能写成确认事实；请改写为怀疑/猜测/可能。");
  }
  if (!/[怀疑猜测可能推测未证实]/u.test(statement)) {
    throw new Error("hypothesis/rumor claim 必须明确标注为怀疑、猜测、可能或未证实。");
  }
}

function recordDailySummary(
  draft: State,
  event: Extract<MemoryEvent, { kind: "record-daily-summary" }>,
): MemoryEventResult {
  assertDailySummaryScope(event.summary);
  const id = createId(draft, "daily");
  draft.public.memory.dailySummaries.push({
    id,
    startDate: assertIsoDateString(
      resolveRelativeTime(event.startDate, draft.public.clock.currentAt),
      "startDate",
    ),
    endDate: assertIsoDateString(
      resolveRelativeTime(event.endDate, draft.public.clock.currentAt),
      "endDate",
    ),
    summary: assertNonEmptyString(event.summary, "summary"),
  });
  return { dailySummaryId: id };
}

function assertDailySummaryScope(summary: string): void {
  const text = assertNonEmptyString(summary, "summary");
  const singleEventMarkers = ["购入", "购买", "采购", "花费", "战斗结论", "调查发现"];
  const summaryMarkers = ["半天", "上午", "下午", "夜间", "当天", "今日", "日终", "整天", "章节"];
  if (
    singleEventMarkers.some((marker) => text.includes(marker)) &&
    !summaryMarkers.some((marker) => text.includes(marker))
  ) {
    throw new Error(
      "record-daily-summary 只用于半天以上、日终或章节摘要；单次采购/调查/战斗结论请用 record-major-event 并提供 claims。",
    );
  }
}
