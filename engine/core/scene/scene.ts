import type {
  ActorId,
  SceneObjectiveId,
  SceneThreatId,
  SituationKind,
  State,
  StoryBeatId,
  StoryWindowState,
} from "../state/state.ts";
import type { SceneBeatThreatInput } from "./scene-beat-schema.ts";
import type { SceneEvent } from "./scene-schema.ts";

import { setScenePresence } from "../actor/actor.ts";
import { recordMemory } from "../knowledge/memory.ts";
import { settleOldestObligation } from "../ledger/obligations.ts";
import { createId } from "../utils/ids.ts";
import { assertNonEmptyString } from "../utils/typebox-validation.ts";

const DEFAULT_ALLOWED_ACTIONS = ["观察当前局势", "回应在场角色", "决定下一步行动"];

export type { SceneEvent } from "./scene-schema.ts";

const MIN_BEAT_OBJECTIVES = 1;
const MAX_BEAT_OBJECTIVES = 5;

export type SceneBeatTurnEvent =
  | { kind: "begin-beat"; input: SceneBeatInput }
  | { kind: "transition-beat"; input: SceneBeatTransitionInput };

export interface SceneBeatInput {
  storyWindow: StoryWindowState;
  objectives: string[];
  threats?: SceneBeatThreatInput[];
  presentActorIds?: ActorId[];
  allyActorIds?: ActorId[];
  situation?: SituationKind;
  reason: string;
}

export type { SceneBeatThreatInput } from "./scene-beat-schema.ts";

export interface SceneBeatTransitionInput {
  completedBeatId: StoryBeatId;
  resolvedObjectiveIds?: SceneObjectiveId[];
  resolvedObjectiveSummaries?: string[];
  resolveAllObjectives?: boolean;
  nextBeat?: SceneBeatInput | null;
  memoryPrompt?: string;
  reason: string;
}

export interface SceneEventResult {
  message: string;
}

export interface SceneBeatResult {
  message: string;
  objectiveIds: SceneObjectiveId[];
  threatIds: SceneThreatId[];
}

export interface SceneBeatTransitionResult {
  message: string;
  resolvedObjectiveIds: SceneObjectiveId[];
  nextBeat: SceneBeatResult | null;
  memoryPrompt: string | null;
}

export function beginSceneBeat(draft: State, input: SceneBeatInput): SceneBeatResult {
  assertNonEmptyString(input.reason, "reason");
  assertBeatObjectives(input.objectives);
  const { objectiveIds, threatIds } = beginSceneBeatOnDraft(draft, input);
  return {
    message: `Scene Beat 已开始：${input.storyWindow.title}；目标 ${objectiveIds.length} 个。`,
    objectiveIds,
    threatIds,
  };
}

function beginSceneBeatOnDraft(
  draft: State,
  input: SceneBeatInput,
): { objectiveIds: SceneObjectiveId[]; threatIds: SceneObjectiveId[] } {
  if (draft.public.scene.storyWindow !== null) {
    throw new Error(formatActiveBeatExistsError(draft.public.scene.storyWindow));
  }
  draft.public.scene.storyWindow = input.storyWindow;
  if (input.situation !== undefined) {
    draft.public.scene.situation = input.situation;
  }
  if (input.presentActorIds !== undefined) {
    assertActorsExist(draft.public.actors, input.presentActorIds, "presentActorIds");
    draft.public.scene.presentActorIds = uniqueActorIds(input.presentActorIds);
  }
  if (input.allyActorIds !== undefined) {
    assertActorsExist(draft.public.actors, input.allyActorIds, "allyActorIds");
    draft.public.allyActorIds = uniqueActorIds(input.allyActorIds);
  }
  const objectiveIds: SceneObjectiveId[] = [];
  const threatIds: SceneObjectiveId[] = [];
  // 逐个写入 draft：createId 扫描 draft 避让，批量 map 会产生重复 ID。
  draft.public.scene.objectives = [];
  for (const summary of input.objectives) {
    const id = createId(draft, "objective");
    objectiveIds.push(id);
    draft.public.scene.objectives.push({
      id,
      summary: assertNonEmptyString(summary, "objectives[]"),
      status: "active",
    });
  }
  draft.public.scene.threats = [];
  for (const threat of input.threats ?? []) {
    const id = createId(draft, "threat");
    threatIds.push(id);
    draft.public.scene.threats.push({
      id,
      summary: assertNonEmptyString(threat.summary, "threat.summary"),
      severity: threat.severity,
    });
  }
  return { objectiveIds, threatIds };
}

export function transitionSceneBeat(
  draft: State,
  input: SceneBeatTransitionInput,
): SceneBeatTransitionResult {
  assertNonEmptyString(input.reason, "reason");
  const memoryPrompt = normalizeOptionalString(input.memoryPrompt);
  let nextBeat: SceneBeatResult | null = null;
  const currentWindow = draft.public.scene.storyWindow;
  if (currentWindow === null) {
    throw new Error(`无法 transition beat：当前没有 storyWindow。`);
  }
  if (currentWindow.currentBeatId !== input.completedBeatId) {
    throw new Error(
      `无法 transition beat：当前 beat 是 ${currentWindow.currentBeatId}，不是 ${input.completedBeatId}。`,
    );
  }
  const shouldResolveAll = shouldResolveAllObjectives(input);
  const resolvedObjectiveIds = resolveObjectiveIds(
    draft.public.scene.objectives,
    input.resolvedObjectiveIds ?? [],
    input.resolvedObjectiveSummaries ?? [],
    shouldResolveAll,
  );
  for (const objectiveId of resolvedObjectiveIds) {
    const objective = draft.public.scene.objectives.find((entry) => entry.id === objectiveId);
    if (objective === undefined) {
      throw new Error(`目标不存在: ${objectiveId}`);
    }
    objective.status = "resolved";
  }
  const activeObjectives = draft.public.scene.objectives.filter(
    (objective) => objective.status !== "resolved",
  );
  if (activeObjectives.length > 0) {
    throw new Error(formatUnresolvedObjectivesError(activeObjectives));
  }
  clearBeatScopedSceneState(draft);
  if (input.nextBeat !== undefined && input.nextBeat !== null) {
    nextBeat = beginSceneBeat(draft, input.nextBeat);
  }
  return {
    message: nextBeat === null ? "Scene Beat 已完成。" : `Scene Beat 已切换：${nextBeat.message}`,
    resolvedObjectiveIds,
    nextBeat,
    memoryPrompt,
  };
}

export function updateScene(draft: State, event: SceneEvent): SceneEventResult {
  if (event.kind !== "begin-beat" && event.kind !== "complete-beat") {
    assertNonEmptyString(event.reason, "reason");
  }
  const result = applySceneEvent(draft, event);
  if (event.kind === "add-objective" || event.kind === "resolve-objective") {
    settleOldestObligation(draft, ["scene-objective"]);
  } else if (event.kind === "add-threat" || event.kind === "clear-threat") {
    settleOldestObligation(draft, ["scene-threat"]);
  }
  return result;
}

function beginBeat(
  draft: State,
  event: Extract<SceneEvent, { kind: "begin-beat" }>,
): SceneEventResult {
  const input: SceneBeatInput = {
    storyWindow: {
      currentArcId: draft.public.scene.storyWindow?.currentArcId ?? "main",
      currentBeatId: event.beatId ?? createId(draft, "beat"),
      title: event.title,
      allowedActions: event.actionPolicy?.allowedActions ?? DEFAULT_ALLOWED_ACTIONS,
      forbiddenEscalations: event.actionPolicy?.forbiddenEscalations ?? [],
      completionCriteria: event.actionPolicy?.completionCriteria ?? event.objectives,
      nextBeatHints: event.actionPolicy?.nextBeatHints ?? [],
    },
    objectives: event.objectives,
    threats: event.threats,
    presentActorIds: event.presence?.presentActorIds,
    allyActorIds: event.presence?.allyActorIds,
    situation: event.situation,
    reason: event.purpose,
  };
  const result = beginSceneBeat(draft, input);
  return { message: result.message };
}

function completeBeat(
  draft: State,
  event: Extract<SceneEvent, { kind: "complete-beat" }>,
): SceneEventResult {
  const currentWindow = draft.public.scene.storyWindow;
  if (currentWindow === null) {
    throw new Error("complete-beat 需要当前存在 Scene Beat。当前没有 active beat。");
  }
  const completedBeatId = currentWindow.currentBeatId;
  const transition = transitionSceneBeat(draft, {
    completedBeatId,
    resolveAllObjectives: true,
    nextBeat:
      event.nextBeat === undefined
        ? null
        : event.nextBeat === null
          ? null
          : buildNextBeatInput(event, completedBeatId),
    reason: event.outcome,
  });
  if (event.memory !== undefined) {
    recordMemory(draft, {
      kind: "record-major-event",
      title: event.memory.title,
      summary: event.memory.summary,
      consequences: event.memory.consequences,
      claims: event.memory.claims,
    });
  }
  if (event.presence !== undefined) {
    setScenePresence(draft, {
      presentActorIds: event.presence.presentActorIds ?? draft.public.scene.presentActorIds,
      allyActorIds: event.presence.allyActorIds ?? draft.public.allyActorIds,
      reason: event.outcome,
    });
  }
  if (event.situation !== undefined) {
    updateScene(draft, {
      kind: "set-situation",
      situation: event.situation,
      reason: event.outcome,
    });
  }
  const transitionMessage = transition.nextBeat?.message ?? "Scene Beat 已完成。";
  return { message: transitionMessage };
}

function buildNextBeatInput(
  event: Extract<SceneEvent, { kind: "complete-beat" }>,
  currentBeatId: string,
): SceneBeatInput | null {
  if (event.nextBeat === null || event.nextBeat === undefined) return null;
  const nb = event.nextBeat;
  return {
    storyWindow: {
      currentArcId: currentBeatId, // keep same arc
      currentBeatId: nb.beatId ?? `${currentBeatId}-next`,
      title: nb.title,
      allowedActions: nb.actionPolicy?.allowedActions ?? DEFAULT_ALLOWED_ACTIONS,
      forbiddenEscalations: nb.actionPolicy?.forbiddenEscalations ?? [],
      completionCriteria: nb.actionPolicy?.completionCriteria ?? nb.objectives,
      nextBeatHints: nb.actionPolicy?.nextBeatHints ?? [],
    },
    objectives: nb.objectives,
    threats: nb.threats,
    presentActorIds: nb.presence?.presentActorIds ?? event.presence?.presentActorIds,
    allyActorIds: nb.presence?.allyActorIds ?? event.presence?.allyActorIds,
    situation: nb.situation ?? event.situation,
    reason: event.outcome,
  };
}
function applySceneEvent(draft: State, event: SceneEvent): SceneEventResult {
  switch (event.kind) {
    case "set-location":
      return setLocation(draft, event);
    case "set-situation":
      return setSituation(draft, event);
    case "add-objective":
      return addObjective(draft, event);
    case "resolve-objective":
      return resolveObjective(draft, event);
    case "add-threat":
      return addThreat(draft, event);
    case "clear-threat":
      return clearThreat(draft, event);
    case "scene-presence":
      return setScenePresence(draft, event);
    case "begin-beat":
      return beginBeat(draft, event);
    case "complete-beat":
      return completeBeat(draft, event);
    default:
      throw new Error("unreachable scene event kind");
  }
}

function setLocation(
  draft: State,
  event: Extract<SceneEvent, { kind: "set-location" }>,
): SceneEventResult {
  assertActiveStoryWindow(draft, "set-location");
  draft.public.scene.location = event.location;
  draft.public.scene.lastResolvedAt = draft.public.clock.currentAt;
  return { message: "地点已修正。" };
}
function setSituation(
  draft: State,
  event: Extract<SceneEvent, { kind: "set-situation" }>,
): SceneEventResult {
  assertActiveStoryWindow(draft, "set-situation");
  draft.public.scene.situation = event.situation;
  return { message: `态势已更新为 ${event.situation}。` };
}

function clearBeatScopedSceneState(draft: State): void {
  draft.public.scene.storyWindow = null;
  draft.public.scene.objectives = [];
  draft.public.scene.threats = [];
}

function addObjective(
  draft: State,
  event: Extract<SceneEvent, { kind: "add-objective" }>,
): SceneEventResult {
  assertActiveStoryWindow(draft, "add-objective");
  const id = createId(draft, "objective");
  draft.public.scene.objectives.push({
    id,
    summary: assertNonEmptyString(event.summary, "summary"),
    status: "active",
  });
  return { message: `目标已加入：${id}。` };
}

function shouldResolveAllObjectives(input: SceneBeatTransitionInput): boolean {
  if (input.resolveAllObjectives === true) {
    return true;
  }
  return (
    input.resolveAllObjectives !== false &&
    (input.resolvedObjectiveIds?.length ?? 0) === 0 &&
    (input.resolvedObjectiveSummaries?.length ?? 0) === 0
  );
}

function resolveObjective(
  draft: State,
  event: Extract<SceneEvent, { kind: "resolve-objective" }>,
): SceneEventResult {
  assertActiveStoryWindow(draft, "resolve-objective");
  const objectiveId = resolveSingleObjectiveId(
    draft.public.scene.objectives,
    event.objectiveId,
    event.objectiveSummary,
  );
  const objective = draft.public.scene.objectives.find((entry) => entry.id === objectiveId);
  if (objective === undefined) {
    throw new Error(`resolve-objective 未找到匹配的目标: ${objectiveId}`);
  }
  // 局部推进只允许解决非最终目标；若这是本 beat 最后一个未解决目标，
  // 收口必须走 complete-beat（带 memory/presence/situation/nextBeat 结尾）。
  const remainingActive = draft.public.scene.objectives.filter(
    (entry) => entry.status !== "resolved" && entry.id !== objectiveId,
  );
  if (remainingActive.length === 0) {
    throw new Error(formatLastObjectiveError());
  }
  objective.status = "resolved";
  return { message: `目标已解决：${objectiveId}。` };
}

function resolveSingleObjectiveId(
  objectives: ReadonlyArray<{ id: SceneObjectiveId; summary: string }>,
  objectiveId: SceneObjectiveId | undefined,
  objectiveSummary: string | undefined,
): SceneObjectiveId {
  if (objectiveId !== undefined) {
    return assertNonEmptyString(objectiveId, "objectiveId");
  }
  if (objectiveSummary !== undefined) {
    const normalizedSummary = assertNonEmptyString(objectiveSummary, "objectiveSummary");
    const objective = findEntryBySummary(objectives, normalizedSummary);
    if (objective === undefined) {
      throw new Error(formatObjectiveSummaryNotFoundError(normalizedSummary, objectives));
    }
    return objective.id;
  }
  throw new Error(formatMissingObjectiveSelectorError(objectives));
}

function addThreat(
  draft: State,
  event: Extract<SceneEvent, { kind: "add-threat" }>,
): SceneEventResult {
  assertActiveStoryWindow(draft, "add-threat");
  const id = createId(draft, "threat");
  draft.public.scene.threats.push({
    id,
    summary: assertNonEmptyString(event.summary, "summary"),
    severity: event.severity,
  });
  return { message: `威胁已加入：${id}。` };
}

function clearThreat(
  draft: State,
  event: Extract<SceneEvent, { kind: "clear-threat" }>,
): SceneEventResult {
  assertActiveStoryWindow(draft, "clear-threat");
  const threatId = resolveSingleThreatId(
    draft.public.scene.threats,
    event.threatId,
    event.threatSummary,
  );
  const before = draft.public.scene.threats.length;
  draft.public.scene.threats = draft.public.scene.threats.filter(
    (threat) => threat.id !== threatId,
  );
  if (draft.public.scene.threats.length === before) {
    throw new Error(formatThreatIdNotFoundError(threatId, draft.public.scene.threats));
  }
  return { message: `威胁已清除：${threatId}。` };
}

/**
 * 解析要清除的威胁 id：threatId 优先，其次 threatSummary 按文本匹配。
 * 与 resolveSingleObjectiveId 同构——threatId 是服务端生成的，模型从 GM Brief
 * 复制 summary 比背 id 更可靠，所以 summary 是主路径。
 */
function resolveSingleThreatId(
  threats: ReadonlyArray<{ id: SceneThreatId; summary: string }>,
  threatId: SceneThreatId | undefined,
  threatSummary: string | undefined,
): SceneThreatId {
  if (threatId !== undefined) {
    return assertNonEmptyString(threatId, "threatId");
  }
  if (threatSummary !== undefined) {
    const normalizedSummary = assertNonEmptyString(threatSummary, "threatSummary");
    const threat = findEntryBySummary(threats, normalizedSummary);
    if (threat === undefined) {
      throw new Error(formatThreatSummaryNotFoundError(normalizedSummary, threats));
    }
    return threat.id;
  }
  throw new Error(formatMissingThreatSelectorError(threats));
}

// summary 查找：先逐字命中，再双向子串模糊。objective / threat 共用（同为 {id, summary}）。
function findEntryBySummary<T extends { summary: string }>(
  entries: ReadonlyArray<T>,
  summary: string,
): T | undefined {
  const exact = entries.find((entry) => entry.summary === summary);
  if (exact !== undefined) {
    return exact;
  }
  return entries.find(
    (entry) => entry.summary.includes(summary) || summary.includes(entry.summary),
  );
}

function renderIdSummaryList(entries: ReadonlyArray<{ id: string; summary: string }>): string[] {
  return entries.map((entry) => `- ${entry.id}: ${entry.summary}`);
}

function renderSummaryList(entries: ReadonlyArray<{ summary: string }>): string[] {
  return entries.map((entry) => `- ${entry.summary}`);
}

function formatThreatIdNotFoundError(
  threatId: SceneThreatId,
  threats: ReadonlyArray<{ id: SceneThreatId; summary: string }>,
): string {
  return [
    `威胁不存在: ${threatId}`,
    "可用 threatId / threatSummary：",
    ...renderIdSummaryList(threats),
  ].join("\n");
}

function formatMissingThreatSelectorError(
  threats: ReadonlyArray<{ id: SceneThreatId; summary: string }>,
): string {
  return [
    "clear-threat 必须提供 threatId 或 threatSummary。",
    "注意：clear-threat 用的是 threatSummary，不是 objectiveSummary（那是 resolve-objective 的字段）。",
    "优先用 threatSummary 逐字复制 GM Brief「当前威胁」里的 summary。",
    "可用 threatId / threatSummary：",
    ...renderIdSummaryList(threats),
  ].join("\n");
}

function formatThreatSummaryNotFoundError(
  summary: string,
  threats: ReadonlyArray<{ id: SceneThreatId; summary: string }>,
): string {
  return [`威胁摘要不存在: ${summary}`, "可用威胁摘要：", ...renderSummaryList(threats)].join("\n");
}

function resolveObjectiveIds(
  objectives: ReadonlyArray<{ id: SceneObjectiveId; summary: string }>,
  ids: readonly SceneObjectiveId[],
  summaries: readonly string[],
  resolveAllObjectives: boolean,
): SceneObjectiveId[] {
  if (resolveAllObjectives) {
    return objectives.map((objective) => objective.id);
  }
  const resolved = new Set<SceneObjectiveId>();
  for (const id of ids) {
    resolved.add(assertNonEmptyString(id, "resolvedObjectiveIds[]"));
  }
  for (const summary of summaries) {
    const normalizedSummary = assertNonEmptyString(summary, "resolvedObjectiveSummaries[]");
    const objective = findEntryBySummary(objectives, normalizedSummary);
    if (objective === undefined) {
      throw new Error(formatObjectiveSummaryNotFoundError(normalizedSummary, objectives));
    }
    resolved.add(objective.id);
  }
  return [...resolved];
}

function formatActiveBeatExistsError(storyWindow: StoryWindowState): string {
  return [
    `无法开始新的 Scene Beat：当前已有 active beat ${storyWindow.currentBeatId}（${storyWindow.title}）。`,
    "同一时间只能有一个 active storyWindow；请先使用 scene event kind=complete-beat 收口当前 beat。",
  ].join("\n");
}

function formatUnresolvedObjectivesError(
  objectives: ReadonlyArray<{ id: SceneObjectiveId; summary: string }>,
): string {
  return [
    "无法 transition beat：仍有未解决目标。",
    "可用 resolvedObjectiveSummaries 或 resolveAllObjectives=true。",
    "如果该目标属于下一 beat：先完成当前 beat（complete-beat），下一 beat 的目标会在 complete+nextBeat 中设置。",
    "可用 objectiveId / objectiveSummary（当前 beat 的）：",
    ...renderIdSummaryList(objectives),
  ].join("\n");
}

function formatMissingObjectiveSelectorError(
  objectives: ReadonlyArray<{ id: SceneObjectiveId; summary: string }>,
): string {
  return [
    "resolve-objective 必须提供 objectiveId 或 objectiveSummary。",
    "如果当前 beat 已全部完成，使用 complete-beat 收口。",
    "可用 objectiveId / objectiveSummary：",
    ...renderIdSummaryList(objectives),
  ].join("\n");
}

function formatObjectiveSummaryNotFoundError(
  summary: string,
  objectives: ReadonlyArray<{ id: SceneObjectiveId; summary: string }>,
): string {
  return [
    `目标摘要不存在: ${summary}`,
    "可用目标摘要（仅当前 beat 的目标）：",
    ...renderSummaryList(objectives),
    "",
    "resolve-objective 只能解决当前 beat 的已有目标，不能跨 beat 操作。",
    "如果该目标属于下一 beat：先等当前 beat 收口，再用 complete-beat + nextBeat 携带目标，然后用 resolve-objective 解决。",
    "如果当前 beat 已全部完成：不用 resolve-objective，直接用 complete-beat 收口。",
  ].join("\n");
}

function assertActiveStoryWindow(draft: State, action: string): void {
  if (draft.public.scene.storyWindow === null) {
    throw new Error(
      [
        `无法执行 ${action}：当前没有 active Scene Beat。`,
        "objectives/threats 是 beat-scoped 状态，只能在 active storyWindow 内增删。",
        "",
        "如果是要解决目标：当前 beat 已结束后目标列表已清空，不需要再 resolve。",
        "如果是要开始新场景：先用 scene event kind=begin-beat 锁定 beat 边界。",
        "普通状态变化（非 scene 事件）：直接通过 commit_turn 的其他 event kind 提交。",
      ].join("\n"),
    );
  }
}

function formatLastObjectiveError(): string {
  return [
    "无法用 resolve-objective 解决本 beat 的最后一个未解决目标。",
    "",
    "resolve-objective 只能解决非最终目标。最后一个目标必须通过 complete-beat 收口，",
    "因为收口同时处理 memory/presence/situation/nextBeat 结尾，resolve-objective 没有这些能力。",
    "",
    "做法：从 commit_turn 中移除这个 resolve-objective，改用 begin/complete-beat 场景子事件。",
  ].join("\n");
}

function assertBeatObjectives(objectives: readonly string[]): void {
  if (objectives.length < MIN_BEAT_OBJECTIVES || objectives.length > MAX_BEAT_OBJECTIVES) {
    throw new Error(
      `objectives 数量超出限制。最多接受 ${MAX_BEAT_OBJECTIVES} 个，当前传入了 ${objectives.length} 个。请合并或拆分场景目标。`,
    );
  }
}

function assertActorsExist(
  actors: Readonly<Record<ActorId, unknown>>,
  actorIds: readonly ActorId[],
  fieldName: string,
): void {
  for (const actorId of actorIds) {
    if (actors[actorId] === undefined) {
      throw new Error(`${fieldName} 包含不存在的 actor: ${actorId}`);
    }
  }
}

function uniqueActorIds(actorIds: readonly ActorId[]): ActorId[] {
  return [...new Set(actorIds.map((actorId) => assertNonEmptyString(actorId, "actorId")))];
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  return assertNonEmptyString(value, "memoryPrompt");
}
