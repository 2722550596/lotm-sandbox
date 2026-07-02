import type { TimeZoneId, TimelineId } from "./state.ts";

import { formatHumanTime } from "./date-time.ts";
import { TIMELINE_IDS, TIMEZONE_IDS } from "./state-enum-schemas.ts";
import { isRecord } from "../utils/typebox-validation.ts";

export interface TimelineStateContext {
  currentAt: string;
  currentAtUtc: string;
  timezone: string;
  displayTime: string;
  currentLocalTime: string;
  timeRangeRule: string;
  scenario: {
    title: string;
    timeline: string;
    premise: string;
  };
  scene: {
    location: string;
    situation: string;
    presentActorIds: string[];
    objectives: string[];
    threats: string[];
  };
  actors: TimelineActorContext[];
  relationshipSignals: TimelineRelationshipSignalContext[];
  undercurrents: string[];
  recentSecretEvents: TimelineSecretEventContext[];
}

export interface TimelineActorContext {
  actorId: string;
  displayName: string;
  kind: string;
  stance: string;
  statusEffects: number;
  sequence: string | null;
  agenda: TimelineActorAgendaContext | null;
  knowledgeLens: TimelineActorKnowledgeLensContext | null;
}

export interface TimelineActorAgendaContext {
  goal: string;
  fear: string;
  currentAssignment: string | null;
  lastIndependentActionAt: string | null;
}

export interface TimelineActorKnowledgeLensContext {
  knows: string[];
  suspects: string[];
  falseBeliefs: string[];
  forbiddenKnowledge: string[];
}


export interface TimelineRelationshipSignalContext {
  id: string;
  actorId: string;
  targetActorId: string;
  signal: string;
  interpretation: string;
  boundary: string;
  sourceEventId: string | null;
  visibility: string;
}


export interface TimelineSecretEventContext {
  time: string;
  summary: string;
  actorIds: string[];
}

const RECENT_SECRET_LIMIT = 6;
const RECENT_RELATIONSHIP_SIGNAL_LIMIT = 8;

export function buildTimelineStateContextFromRaw(raw: unknown): TimelineStateContext {
  const state = selectStateRecord(raw);
  const publicState = requireRecord(state["public"], "state.public");
  const secrets = requireRecord(state["secrets"], "state.secrets");
  const scenario = requireRecord(publicState["scenario"], "public.scenario");
  const clock = requireRecord(publicState["clock"], "public.clock");
  const scene = requireRecord(publicState["scene"], "public.scene");
  const actors = requireRecord(publicState["actors"], "public.actors");
  const secretEventLog = optionalArray(secrets["secretEventLog"]);
  const relationshipSignals = recentRelationshipSignals(
    optionalArray(publicState["relationshipSignals"]),
    optionalArray(secrets["relationshipSignals"]),
  );
  const actorStates = requireRecord(secrets["actorStates"], "secrets.actorStates");
  const actorAgendas = facetByActorId(actorStates, "agenda");
  const actorKnowledgeLenses = facetByActorId(actorStates, "knowledgeLens");
  const currentAt = requireString(clock["currentAt"], "clock.currentAt");
  const timezone = requireTimezone(clock["timezone"], "clock.timezone");
  const displayTime = formatHumanTime(currentAt, timezone).display;
  const timeline = requireTimelineId(scenario["timeline"], "scenario.timeline");

  const recentSecretEvents = secretEventLog
    .slice(-RECENT_SECRET_LIMIT)
    .map((event, index) => secretEventContext(event, index));

  const undercurrents: string[] = optionalArray(secrets["undercurrents"]).map((u) => {
    const r = requireRecord(u, "undercurrents[]");
    const label = requireString(r["label"], "undercurrent.label");
    const filled = requireString(String(r["filled"] ?? ""), "undercurrent.filled");
    const size = requireString(String(r["size"] ?? ""), "undercurrent.size");
    const actorIds = stringArray(r["actorIds"], "undercurrent.actorIds");
    const visibility = requireString(r["visibility"], "undercurrent.visibility");
    return `${label} [${filled}/${size}] · actor:${actorIds.join(", ")} · ${visibility}`;
  });
  return {
    currentAt,
    currentAtUtc: currentAt,
    timezone,
    displayTime,
    currentLocalTime: displayTime,
    timeRangeRule: `所有 timeWindow/timeRange.start/end 必须使用 ISO UTC；当前 UTC ${currentAt} = ${timezone} 本地 ${displayTime}；不得把本地时钟直接加 Z 输出；timeRange.end <= currentAt。`,
    scenario: {
      title: requireString(scenario["title"], "scenario.title"),
      timeline,
      premise: requireString(scenario["premise"], "scenario.premise"),
    },
    scene: {
      location: formatStateFileLocation(requireRecord(scene["location"], "scene.location")),
      situation: requireString(scene["situation"], "scene.situation"),
      presentActorIds: stringArray(scene["presentActorIds"], "scene.presentActorIds"),
      objectives: formatObjectives(optionalArray(scene["objectives"])),
      threats: formatThreats(optionalArray(scene["threats"])),
    },
    actors: Object.entries(actors).map(([actorId, actor]) =>
      actorContext(actorId, actor, actorAgendas.get(actorId), actorKnowledgeLenses.get(actorId)),
    ),
    relationshipSignals,
    recentSecretEvents,
    undercurrents,
  };
}

function actorContext(
  actorId: string,
  value: unknown,
  agendaValue: unknown,
  knowledgeLensValue: unknown,
): TimelineActorContext {
  const actor = requireRecord(value, `actors.${actorId}`);
  const presentation = requireRecord(actor["presentation"], `actors.${actorId}.presentation`);
  const relationship = requireRecord(
    actor["relationshipToProtagonist"],
    `actors.${actorId}.relationshipToProtagonist`,
  );
  const condition = requireRecord(actor["condition"], `actors.${actorId}.condition`);
  const sequence = optionalRecord(actor["sequence"]);
  return {
    actorId,
    displayName: requireString(presentation["renderName"], `actors.${actorId}.renderName`),
    kind: requireString(actor["kind"], `actors.${actorId}.kind`),
    stance: requireString(relationship["stance"], `actors.${actorId}.stance`),
    statusEffects: optionalArray(condition["statusEffects"]).length,
    sequence: sequence === null ? null : (optionalString(sequence["currentSequence"]) ?? null),
    agenda: agendaValue === undefined ? null : agendaContext(actorId, agendaValue),
    knowledgeLens:
      knowledgeLensValue === undefined ? null : knowledgeLensContext(actorId, knowledgeLensValue),
  };
}

function agendaContext(actorId: string, value: unknown): TimelineActorAgendaContext {
  const agenda = requireRecord(value, `actorAgendas.${actorId}`);
  return {
    goal: requireString(agenda["goal"], `actorAgendas.${actorId}.goal`),
    fear: requireString(agenda["fear"], `actorAgendas.${actorId}.fear`),
    currentAssignment: nullableString(agenda["currentAssignment"], `actorAgendas.${actorId}.currentAssignment`),
    lastIndependentActionAt: nullableString(
      agenda["lastIndependentActionAt"],
      `actorAgendas.${actorId}.lastIndependentActionAt`,
    ),
  };
}

function knowledgeLensContext(actorId: string, value: unknown): TimelineActorKnowledgeLensContext {
  const lens = requireRecord(value, `actorKnowledgeLenses.${actorId}`);
  return {
    knows: stringArray(lens["knows"], `actorKnowledgeLenses.${actorId}.knows`),
    suspects: stringArray(lens["suspects"], `actorKnowledgeLenses.${actorId}.suspects`),
    falseBeliefs: stringArray(lens["falseBeliefs"], `actorKnowledgeLenses.${actorId}.falseBeliefs`),
    forbiddenKnowledge: stringArray(
      lens["forbiddenKnowledge"],
      `actorKnowledgeLenses.${actorId}.forbiddenKnowledge`,
    ),
  };
}

function relationshipSignalContext(
  value: unknown,
  index: number,
): TimelineRelationshipSignalContext {
  const signal = requireRecord(value, `relationshipSignals[${index}]`);
  return {
    id: requireString(signal["id"], `relationshipSignals[${index}].id`),
    actorId: requireString(signal["actorId"], `relationshipSignals[${index}].actorId`),
    targetActorId: requireString(
      signal["targetActorId"],
      `relationshipSignals[${index}].targetActorId`,
    ),
    signal: requireString(signal["signal"], `relationshipSignals[${index}].signal`),
    interpretation: requireString(
      signal["interpretation"],
      `relationshipSignals[${index}].interpretation`,
    ),
    boundary: requireString(signal["boundary"], `relationshipSignals[${index}].boundary`),
    sourceEventId: nullableString(
      signal["sourceEventId"],
      `relationshipSignals[${index}].sourceEventId`,
    ),
    visibility: requireString(signal["visibility"], `relationshipSignals[${index}].visibility`),
  };
}

function recentRelationshipSignals(
  publicSignals: readonly unknown[],
  secretSignals: readonly unknown[],
): TimelineRelationshipSignalContext[] {
  return [...publicSignals, ...secretSignals]
    .map((signal, index) => relationshipSignalContext(signal, index))
    .toSorted((left, right) => relationshipSignalOrder(left.id) - relationshipSignalOrder(right.id))
    .slice(-RECENT_RELATIONSHIP_SIGNAL_LIMIT);
}

function relationshipSignalOrder(id: string): number {
  const match = /-(\d+)$/u.exec(id);
  return match === null ? 0 : Number(match[1]);
}


function secretEventContext(value: unknown, index: number): TimelineSecretEventContext {
  const event = requireRecord(value, `secretEventLog[${index}]`);
  return {
    time: requireString(event["time"], `secretEventLog[${index}].time`),
    summary: requireString(event["summary"], `secretEventLog[${index}].summary`),
    actorIds: stringArray(event["relatedActorIds"], `secretEventLog[${index}].relatedActorIds`),
  };
}


function formatStateFileLocation(location: Record<string, unknown>): string {
  return ["region", "site", "detail"]
    .map((key) => optionalString(location[key]))
    .filter((part) => part !== undefined && part.length > 0)
    .join(" · ");
}

function formatObjectives(values: readonly unknown[]): string[] {
  return values.map((value, index) => {
    const objective = requireRecord(value, `scene.objectives[${index}]`);
    return `${requireString(objective["id"], "objective.id")}: ${requireString(objective["summary"], "objective.summary")}`;
  });
}

function formatThreats(values: readonly unknown[]): string[] {
  return values.map((value, index) => {
    const threat = requireRecord(value, `scene.threats[${index}]`);
    return `${requireString(threat["severity"], "threat.severity")}: ${requireString(threat["summary"], "threat.summary")}`;
  });
}



function facetByActorId(
  actorStates: Record<string, unknown>,
  facet: "agenda" | "knowledgeLens",
): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const [actorId, bundleValue] of Object.entries(actorStates)) {
    const bundle = optionalRecord(bundleValue);
    if (bundle === null) {
      continue;
    }
    const value = bundle[facet];
    if (value !== undefined) {
      result.set(actorId, requireRecord(value, `secrets.actorStates.${actorId}.${facet}`));
    }
  }
  return result;
}

function selectStateRecord(raw: unknown): Record<string, unknown> {
  const root = requireRecord(raw, "state root");
  const nestedState = optionalRecord(root["state"]);
  return nestedState ?? root;
}

function requireTimelineId(value: unknown, fieldName: string): TimelineId {
  const timeline = requireString(value, fieldName);
  if (isTimelineId(timeline)) {
    return timeline;
  }
  throw new Error(`${fieldName} 不支持: ${timeline}。`);
}

function isTimelineId(value: string): value is TimelineId {
  return TIMELINE_IDS.some((timelineId) => timelineId === value);
}

function requireTimezone(value: unknown, fieldName: string): TimeZoneId {
  const timezone = requireString(value, fieldName);
  if (isTimeZoneId(timezone)) {
    return timezone;
  }
  throw new Error(`${fieldName} 不支持: ${timezone}。`);
}

function isTimeZoneId(value: string): value is TimeZoneId {
  return TIMEZONE_IDS.some((timezoneId) => timezoneId === value);
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象。`);
  }
  return value;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} 必须是非空字符串。`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value, fieldName);
}

function stringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是字符串数组。`);
  }
  return value.map((entry) => requireString(entry, `${fieldName}[]`));
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
