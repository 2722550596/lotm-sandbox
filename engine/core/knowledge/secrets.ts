import type {
  ActorId,
  ActorSecretSlots,
  HiddenWorldFact,
  SecretSlot,
  State,
} from "../state/state.ts";
import type {
  ConfigureSecretInput,
  PrivateResolveEvent,
  RevealSecretEvent,
  SecretStringInput,
} from "./secrets-schema.ts";
import type { SecretCandidate } from "./semantic-reveal.ts";

import { getActorSecretSlots, setActorSecretSlots } from "../actor/secret-actor-state.ts";
import { retireHook } from "../ledger/hooks.ts";
import { createId } from "../utils/ids.ts";
import { assertNonEmptyString } from "../utils/typebox-validation.ts";
import { recordMemory } from "./memory.ts";
import { judgeSecrets, judgeHiddenReaction, judgeCompatibility } from "./semantic-reveal.ts";
export type {
  ConfigureSecretInput,
  PrivateResolveEvent,
  RevealSecretEvent,
  SecretStringInput,
} from "./secrets-schema.ts";

// ===========================================================================
// Result interfaces
// ===========================================================================

export interface ConfigureSecretResult {
  message: string;
}

export type RevealSecretOutcome =
  | "revealed"
  | "foreshadowed"
  | "insufficient-evidence"
  | "incorrect";

export interface RevealSecretResult {
  outcome: RevealSecretOutcome;
  narrativeConstraints: string[];
  revealedSecrets?: Array<{ kind: string; summary: string }>;
}

// ===========================================================================
// Internal helpers
// ===========================================================================

function recordSecretEvent(draft: State, summary: string, relatedActorIds: string[] = []): void {
  draft.secrets.secretEventLog.push({
    id: createId(draft, "secret-event"),
    time: draft.public.clock.currentAt,
    summary,
    relatedActorIds: [...new Set(relatedActorIds)],
  });
}

function buildStringSecretSlot(
  existing: SecretSlot<string> | undefined,
  id: string,
  input: SecretStringInput,
): SecretSlot<string> {
  const revealCondition = assertNonEmptyString(input.revealCondition, "revealCondition");
  return {
    id: existing?.id ?? id,
    value: assertNonEmptyString(input.value, "secret.value"),
    revealState: existing?.revealState ?? "hidden",
    revealCondition,
  };
}

function appendStringSecretSlots(
  draft: State,
  slots: Array<SecretSlot<string>>,
  inputs: SecretStringInput[],
): void {
  for (const input of inputs) {
    const value = assertNonEmptyString(input.value, "secret.value");
    const existingIndex = slots.findIndex((slot) => slot.value === value);
    const existing = existingIndex === -1 ? undefined : slots[existingIndex];
    const slot = buildStringSecretSlot(existing, createId(draft, "sec"), input);
    if (existingIndex === -1) {
      slots.push(slot);
    } else {
      slots[existingIndex] = slot;
    }
  }
}

function createEmptyActorSecretSlots(actorId: ActorId): ActorSecretSlots {
  return {
    actorId,
    beyonderSecrets: [],
    privateMotives: [],
    unrevealedAffiliations: [],
  };
}

function revealEvidenceText(event: RevealSecretEvent): string {
  const needle = event.kind === "claim-reveal" ? event.claim : event.trigger;
  return `${needle}\n${event.evidence}`;
}

// ===========================================================================
// configureSecret — 配置隐藏秘密
// ===========================================================================

export function configureSecret(draft: State, input: ConfigureSecretInput): ConfigureSecretResult {
  switch (input.kind) {
    case "actor-beyonder":
      return configureActorBeyonderSecrets(draft, input);
    case "actor-private":
      return configureActorPrivateSecrets(draft, input);
    case "world-fact":
      return configureWorldFact(draft, input);
    default:
      // Exhaustive check — all variants handled above
      return input satisfies never;
  }
}

function configureActorBeyonderSecrets(
  draft: State,
  input: ConfigureSecretInput & { kind: "actor-beyonder" },
): ConfigureSecretResult {
  assertNonEmptyString(input.actorId, "actorId");
  assertNonEmptyString(input.reason, "reason");
  if (draft.public.actors[input.actorId] === undefined) {
    throw new Error(`configure_secret: actor 不存在: ${input.actorId}`);
  }

  const existing =
    getActorSecretSlots(draft.secrets, input.actorId) ?? createEmptyActorSecretSlots(input.actorId);
  appendStringSecretSlots(draft, existing.beyonderSecrets, input.secrets);
  setActorSecretSlots(draft.secrets, input.actorId, existing);
  recordSecretEvent(draft, `${input.actorId} 的非凡者秘密已配置`, [input.actorId]);

  return { message: `非凡者秘密已配置：${input.actorId}。` };
}

function configureActorPrivateSecrets(
  draft: State,
  input: ConfigureSecretInput & { kind: "actor-private" },
): ConfigureSecretResult {
  assertNonEmptyString(input.actorId, "actorId");
  assertNonEmptyString(input.reason, "reason");
  if (draft.public.actors[input.actorId] === undefined) {
    throw new Error(`configure_secret: actor 不存在: ${input.actorId}`);
  }

  const existing =
    getActorSecretSlots(draft.secrets, input.actorId) ?? createEmptyActorSecretSlots(input.actorId);
  appendStringSecretSlots(draft, existing.privateMotives, input.secrets);
  setActorSecretSlots(draft.secrets, input.actorId, existing);
  recordSecretEvent(draft, `${input.actorId} 的隐藏动机/归属已配置`, [input.actorId]);

  return { message: `actor secrets 已配置：${input.actorId}。` };
}

function configureWorldFact(
  draft: State,
  input: ConfigureSecretInput & { kind: "world-fact" },
): ConfigureSecretResult {
  const revealCondition = assertNonEmptyString(input.revealCondition, "revealCondition");

  const existing = draft.secrets.hiddenWorldFacts.find((fact) => fact.text === input.text);
  if (existing !== undefined) {
    existing.revealCondition = revealCondition;
    if (input.relatedActorIds !== undefined && input.relatedActorIds.length > 0) {
      existing.relatedActorIds = input.relatedActorIds;
    }
    return { message: `世界事实已更新：${input.text}` };
  }

  draft.secrets.hiddenWorldFacts.push({
    id: createId(draft, "world-fact"),
    text: input.text,
    relatedActorIds: input.relatedActorIds ?? [],
    revealCondition,
    revealState: "hidden",
  });
  return { message: `世界事实已记录：${input.text}` };
}

// ===========================================================================
// revealSecret — 纯揭示
// ===========================================================================

export async function revealSecret(
  draft: State,
  event: RevealSecretEvent,
): Promise<RevealSecretResult> {
  assertNonEmptyString(event.actorId, "actorId");
  const actor = draft.public.actors[event.actorId];
  if (actor === undefined) {
    throw new Error(`reveal_secret: actor 不存在: ${event.actorId}`);
  }

  const evidence = revealEvidenceText(event);
  const needle = event.kind === "claim-reveal" ? event.claim : event.trigger;

  // 收集所有候选秘密
  const candidates: SecretCandidate[] = [];
  const slotLookup = new Map<string, SecretSlot<string>>();
  const factLookup = new Map<string, HiddenWorldFact>();

  const slots = getActorSecretSlots(draft.secrets, event.actorId);
  if (slots !== undefined) {
    for (const s of slots.beyonderSecrets) {
      if (s.revealState !== "revealed") {
        candidates.push({
          id: s.id,
          kind: "actor-beyonder",
          value: s.value,
          revealCondition: s.revealCondition,
        });
        slotLookup.set(s.id, s);
      }
    }
    for (const s of slots.privateMotives) {
      if (s.revealState !== "revealed") {
        candidates.push({
          id: s.id,
          kind: "actor-private",
          value: s.value,
          revealCondition: s.revealCondition,
        });
        slotLookup.set(s.id, s);
      }
    }
    for (const s of slots.unrevealedAffiliations) {
      if (s.revealState !== "revealed") {
        candidates.push({
          id: s.id,
          kind: "actor-private",
          value: s.value,
          revealCondition: s.revealCondition,
        });
        slotLookup.set(s.id, s);
      }
    }
  }

  for (const fact of draft.secrets.hiddenWorldFacts) {
    if (fact.revealState !== "revealed") {
      candidates.push({
        id: fact.id,
        kind: "world-fact",
        value: fact.text,
        revealCondition: fact.revealCondition,
      });
      factLookup.set(fact.id, fact);
    }
  }

  if (candidates.length === 0) {
    return {
      outcome: "insufficient-evidence",
      narrativeConstraints: ["所有已知秘密已被揭示，无可揭示内容"],
    };
  }

  // 推理判断（纯 LLM 路径）
  const judgments = await judgeSecrets({ kind: event.kind, needle, evidence }, candidates);

  // 应用判断结果
  let revealed = false;
  let foreshadowed = false;
  const revealedIds: string[] = [];

  for (const j of judgments) {
    const fact = factLookup.get(j.id);
    if (fact !== undefined) {
      if (j.verdict === "revealed") {
        fact.revealState = "revealed";
        revealed = true;
        revealedIds.push(fact.id);
      } else if (j.verdict === "hinted" && fact.revealState === "hidden") {
        fact.revealState = "foreshadowed";
        foreshadowed = true;
      }
      continue;
    }

    const slot = slotLookup.get(j.id);
    if (slot !== undefined) {
      if (j.verdict === "revealed") {
        slot.revealState = "revealed";
        revealed = true;
        revealedIds.push(slot.id);
      } else if (j.verdict === "hinted" && slot.revealState === "hidden") {
        slot.revealState = "foreshadowed";
        foreshadowed = true;
      }
    }
  }
  if (revealed) {
    // ── 收集被揭示的秘密，同步到 public memory ──
    const revealedEntries: Array<{ kind: string; value: string }> = [];

    for (const fact of draft.secrets.hiddenWorldFacts) {
      if (fact.revealState === "revealed") {
        revealedEntries.push({ kind: "world-fact", value: fact.text });
      }
    }
    const revealedActorSlots = getActorSecretSlots(draft.secrets, event.actorId);
    if (revealedActorSlots !== undefined) {
      for (const s of revealedActorSlots.beyonderSecrets) {
        if (s.revealState === "revealed")
          revealedEntries.push({ kind: "actor-beyonder", value: s.value });
      }
      for (const s of revealedActorSlots.privateMotives) {
        if (s.revealState === "revealed")
          revealedEntries.push({ kind: "actor-private", value: s.value });
      }
      for (const s of revealedActorSlots.unrevealedAffiliations) {
        if (s.revealState === "revealed")
          revealedEntries.push({ kind: "actor-private", value: s.value });
      }
    }

    const isProtagonist = event.actorId === draft.public.protagonistActorId;
    for (const entry of revealedEntries) {
      const scope = entry.kind === "world-fact" ? "world" : isProtagonist ? "protagonist" : "npc";
      recordMemory(draft, {
        kind: "pin-fact",
        scope,
        subject: event.actorId,
        text: entry.value,
        sourceEventId: null,
        claims: [{ kind: "mundane", statement: entry.value, certainty: "confirmed" }],
      });
    }

    // 收口关联 hook：找到 relatedSecretId 匹配已揭示秘密的 hook 并 retire
    for (const hook of draft.public.hooks) {
      if (
        hook.relatedSecretId !== undefined &&
        revealedIds.includes(hook.relatedSecretId) &&
        hook.status !== "paid" &&
        hook.status !== "retired"
      ) {
        retireHook(draft, hook.id, `秘密已揭示（${event.actorId}）`);
      }
    }

    recordSecretEvent(draft, `${event.actorId} 的秘密被揭示`, [event.actorId]);
    return {
      outcome: "revealed",
      narrativeConstraints: ["该事实已从 hidden-canonical 转为 public，并同步到 public memory。"],
      revealedSecrets: revealedEntries.map((e) => ({ kind: e.kind, summary: e.value })),
    };
  }

  if (foreshadowed) {
    return {
      outcome: "foreshadowed",
      narrativeConstraints: ["线索成立，但尚不足以完全揭示。渲染器可用预感/梦境/异象等方式暗示"],
    };
  }

  return {
    outcome: "insufficient-evidence",
    narrativeConstraints: ["证据不足以触发现有隐藏事实；继续收集线索后再试"],
  };
}

// ===========================================================================
// privateResolve — 窄口私密结算
// ===========================================================================

export interface PrivateResolveResult {
  outcome: "no-special-effect" | "subtle-reaction" | "strong-reaction" | "dangerous-escalation";
  narrativeConstraints: string[];
}

export async function privateResolve(
  draft: State,
  event: PrivateResolveEvent,
): Promise<PrivateResolveResult> {
  return event.kind === "hidden-reaction"
    ? await hiddenReaction(draft, event)
    : await secretCompatibility(draft, event);
}

async function hiddenReaction(
  draft: State,
  event: Extract<PrivateResolveEvent, { kind: "hidden-reaction" }>,
): Promise<PrivateResolveResult> {
  assertNonEmptyString(event.stimulus, "stimulus");
  assertNonEmptyString(event.actorId, "actorId");
  assertNonEmptyString(event.publicContext, "publicContext");

  const slots = getActorSecretSlots(draft.secrets, event.actorId);
  if (slots === undefined) {
    return {
      outcome: "no-special-effect",
      narrativeConstraints: ["NPC 反应无异常。渲染器正常叙事即可。"],
    };
  }

  // 构建候选秘密列表
  const candidates: SecretCandidate[] = [];
  for (const s of slots.beyonderSecrets) {
    if (s.revealState !== "revealed") {
      candidates.push({
        id: s.id,
        kind: "actor-beyonder",
        value: s.value,
        revealCondition: s.revealCondition,
      });
    }
  }
  for (const s of slots.privateMotives) {
    if (s.revealState !== "revealed") {
      candidates.push({
        id: s.id,
        kind: "actor-private",
        value: s.value,
        revealCondition: s.revealCondition,
      });
    }
  }
  for (const s of slots.unrevealedAffiliations) {
    if (s.revealState !== "revealed") {
      candidates.push({
        id: s.id,
        kind: "actor-private",
        value: s.value,
        revealCondition: s.revealCondition,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      outcome: "no-special-effect",
      narrativeConstraints: ["NPC 反应无异常。渲染器正常叙事即可。"],
    };
  }

  // 语义推理判断：stimulus + publicContext 是否触及隐藏秘密
  const judgments = await judgeHiddenReaction(event.stimulus, event.publicContext, candidates);

  const triggeredCount = judgments.filter((j) => j.triggered).length;

  if (triggeredCount === 0) {
    return {
      outcome: "no-special-effect",
      narrativeConstraints: ["NPC 反应无异常。渲染器正常叙事即可。"],
    };
  }

  if (triggeredCount > 3) {
    return {
      outcome: "dangerous-escalation",
      narrativeConstraints: [
        "NPC 隐藏秘密被刺激触及。渲染器用「对方神色骤变/突然沉默/试图转移话题」来表现。",
        "不允许直接描写隐藏秘密的具体内容。",
      ],
    };
  }
  if (triggeredCount > 1) {
    return {
      outcome: "strong-reaction",
      narrativeConstraints: [
        "NPC 有明显的隐藏反应。渲染器用「眼神闪烁/停顿片刻/语气变得谨慎」来表现。",
        "不允许直接描写隐藏秘密的具体内容。",
      ],
    };
  }
  return {
    outcome: "subtle-reaction",
    narrativeConstraints: [
      "NPC 有细微的隐藏反应。渲染器用「不易察觉的停顿/指尖微动」来表现。",
      "不允许直接描写隐藏秘密的具体内容。",
    ],
  };
}

async function secretCompatibility(
  draft: State,
  event: Extract<PrivateResolveEvent, { kind: "secret-compatibility" }>,
): Promise<PrivateResolveResult> {
  assertNonEmptyString(event.actorId, "actorId");
  assertNonEmptyString(event.targetActorId, "targetActorId");

  const slotsA = getActorSecretSlots(draft.secrets, event.actorId);
  const slotsB = getActorSecretSlots(draft.secrets, event.targetActorId);

  if (slotsA === undefined || slotsB === undefined) {
    return {
      outcome: "no-special-effect",
      narrativeConstraints: ["两方之间无隐藏相性影响。"],
    };
  }

  // 收集未揭示的秘密值
  const secretsA: string[] = [];
  for (const s of [
    ...slotsA.beyonderSecrets,
    ...slotsA.privateMotives,
    ...slotsA.unrevealedAffiliations,
  ]) {
    if (s.revealState !== "revealed") secretsA.push(s.value);
  }
  const secretsB: string[] = [];
  for (const s of [
    ...slotsB.beyonderSecrets,
    ...slotsB.privateMotives,
    ...slotsB.unrevealedAffiliations,
  ]) {
    if (s.revealState !== "revealed") secretsB.push(s.value);
  }

  // 语义推理判断：两方的隐藏秘密之间是否存在关联
  const judgment = await judgeCompatibility({
    secretsA,
    secretsB,
    interaction: event.interaction,
  });

  if (!judgment.compatible) {
    return {
      outcome: "no-special-effect",
      narrativeConstraints: ["两方之间无隐藏相性影响。"],
    };
  }

  return {
    outcome: "subtle-reaction",
    narrativeConstraints: [
      "双方有潜在的隐藏相性（共享秘密或关联）。渲染器用「若有所察/气氛微妙」来表现。",
      "不允许直接描写隐藏秘密的具体内容。",
    ],
  };
}

// ===========================================================================
// Debug helpers
// ===========================================================================
