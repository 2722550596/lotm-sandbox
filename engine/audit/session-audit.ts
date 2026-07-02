/**
 * Session JSONL 叙事纪律审计（backlog #8）。
 *
 * 把「感觉最近 GM 变软了」变成数字：时间推进覆盖率、工具调用分布、
 * get_status 冗余率、连续无代价轮数、输出契约违规、parallel-line 触发命中率、
 * backstage 义务账本结算情况（引擎实账，schema v17+）。
 *
 * 全部纯函数：输入是 JSONL 行解析出的 entry 数组，输出是结构化报告。
 * CLI 薄壳在 `scripts/audit-session.ts`。
 */

import type { LintFinding, ProseLengthContext } from "./lint-rules.ts";

import {
  collectUnrevealedSecretStrings,
  findSecretLeaks,
  lintFinalProse,
  lintProseLength,
  proseLengthContextFromPacket,
} from "./lint-rules.ts";

// ---------- JSONL entry 解析 ----------

interface RawEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  message?: Record<string, unknown>;
  customType?: string;
  data?: unknown;
  /** custom_message entry 的正文（双 pass 渲染轮的 rendered-prose 走这里） */
  content?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSessionJsonl(content: string): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // 损坏行直接跳过：审计工具要能处理被手工修过的 session 文件
      continue;
    }
    if (!isRecord(parsed) || typeof parsed["type"] !== "string") continue;
    entries.push({
      type: parsed["type"],
      id: typeof parsed["id"] === "string" ? parsed["id"] : undefined,
      parentId: typeof parsed["parentId"] === "string" ? parsed["parentId"] : undefined,
      message: isRecord(parsed["message"]) ? parsed["message"] : undefined,
      customType: typeof parsed["customType"] === "string" ? parsed["customType"] : undefined,
      data: parsed["data"],
      content: parsed["content"],
    });
  }
  return entries;
}

/**
 * session tree 可能有废弃分支（rewind 未剪净）。
 * 取文件中最后一个带 id 的 entry 作为 leaf，沿 parentId 回溯出 active path。
 */
export function reconstructActivePath(entries: readonly RawEntry[]): RawEntry[] {
  const byId = new Map<string, RawEntry>();
  for (const entry of entries) {
    if (entry.id !== undefined) byId.set(entry.id, entry);
  }
  let leaf: RawEntry | undefined;
  for (const entry of entries) {
    if (entry.id !== undefined) leaf = entry;
  }
  if (leaf === undefined) return [...entries];

  const path: RawEntry[] = [];
  const seen = new Set<string>();
  let cursor: RawEntry | undefined = leaf;
  while (cursor !== undefined) {
    if (cursor.id !== undefined) {
      if (seen.has(cursor.id)) break; // 环防御
      seen.add(cursor.id);
    }
    path.push(cursor);
    cursor =
      cursor.parentId !== undefined && cursor.parentId !== null
        ? byId.get(cursor.parentId)
        : undefined;
  }
  return path.toReversed();
}

// ---------- Turn 分组 ----------

export interface AuditToolCall {
  name: string;
  args: unknown;
  /** 对应 toolResult 非 error；找不到结果按 false（未完成的调用不算 accepted） */
  accepted: boolean;
}

export interface AuditTurn {
  /** active path 上第几个玩家轮（1-based） */
  index: number;
  userText: string;
  toolCalls: AuditToolCall[];
  /** 本轮全部可见文本拼接（assistant text + rendered-prose 渲染正文） */
  fullText: string;
  /**
   * 本轮最终玩家可见正文。
   * 双 pass session：rendered-prose custom message（优先）；
   * 单 pass 老 session：最后一个含 text 的 assistant 消息。
   */
  finalProse: string;
  /** 本轮结束时最新 domain-state 快照中的未揭示秘密字符串 */
  unrevealedSecrets: string[];
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string") {
      parts.push(block["text"]);
    }
  }
  return parts.join("\n");
}

interface PendingToolCall {
  id: string;
  name: string;
  args: unknown;
}

function extractToolCalls(content: unknown): PendingToolCall[] {
  if (!Array.isArray(content)) return [];
  const calls: PendingToolCall[] = [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block["type"] === "toolCall" &&
      typeof block["id"] === "string" &&
      typeof block["name"] === "string"
    ) {
      calls.push({ id: block["id"], name: block["name"], args: block["arguments"] });
    }
  }
  return calls;
}

export function groupTurns(path: readonly RawEntry[]): AuditTurn[] {
  const turns: AuditTurn[] = [];
  let current: AuditTurn | undefined;
  let latestSecrets: string[] = [];
  const pendingResults = new Map<string, AuditToolCall>();

  for (const entry of path) {
    if (entry.type === "custom" && entry.customType === "domain-state" && isRecord(entry.data)) {
      const state = entry.data["state"];
      if (isRecord(state)) latestSecrets = collectUnrevealedSecretStrings(state["secrets"]);
      if (current !== undefined) current.unrevealedSecrets = latestSecrets;
      continue;
    }
    // 双 pass 渲染轮的最终正文：rendered-prose custom message 覆盖 assistant text
    if (entry.type === "custom_message" && entry.customType === "rendered-prose") {
      if (current !== undefined) {
        const prose = blockText(entry.content);
        if (prose.trim().length > 0) {
          current.fullText = current.fullText.length > 0 ? `${current.fullText}\n${prose}` : prose;
          current.finalProse = prose;
        }
      }
      continue;
    }
    if (entry.type !== "message" || entry.message === undefined) continue;
    const role = entry.message["role"];
    const content = entry.message["content"];

    if (role === "user") {
      current = {
        index: turns.length + 1,
        userText: blockText(content),
        toolCalls: [],
        fullText: "",
        finalProse: "",
        unrevealedSecrets: latestSecrets,
      };
      turns.push(current);
      continue;
    }
    if (current === undefined) continue;

    if (role === "assistant") {
      const text = blockText(content);
      if (text.trim().length > 0) {
        current.fullText = current.fullText.length > 0 ? `${current.fullText}\n${text}` : text;
        current.finalProse = text;
      }
      for (const call of extractToolCalls(content)) {
        const record: AuditToolCall = { name: call.name, args: call.args, accepted: false };
        current.toolCalls.push(record);
        pendingResults.set(call.id, record);
      }
      continue;
    }
    if (role === "toolResult") {
      const callId = entry.message["toolCallId"];
      if (typeof callId === "string") {
        const record = pendingResults.get(callId);
        if (record !== undefined) {
          record.accepted = entry.message["isError"] !== true;
          pendingResults.delete(callId);
        }
      }
    }
  }
  return turns;
}

// ---------- 指标 ----------

const CANONICAL_COMMIT_TOOLS = new Set(["commit_turn", "progress_scene_beat"]);

/** 不改变 state 的只读工具；get_status 冗余判定用 */
const READ_ONLY_TOOLS = new Set([
  "get_status",
  "lookup",
  "read",
  "web_search",
  "fetch_content",
  "get_search_content",
  "subagent",
  "get_state_schema",
]);

function topLevelTime(args: unknown): { present: boolean; elapsedMinutes: number } {
  if (!isRecord(args)) return { present: false, elapsedMinutes: 0 };
  const time = args["time"];
  if (!isRecord(time)) return { present: false, elapsedMinutes: 0 };
  const minutes = time["elapsedMinutes"];
  return { present: true, elapsedMinutes: typeof minutes === "number" ? minutes : 0 };
}

export interface TimeCoverage {
  acceptedCanonicalCalls: number;
  acceptedWithTime: number;
  /** acceptedWithTime / acceptedCanonicalCalls；无样本时为 1 */
  callRatio: number;
  turnsWithCanonical: number;
  turnsCovered: number;
  /** 有 accepted canonical commit 但全部缺顶层 time 的轮号 */
  missingTimeTurns: number[];
}

export function measureTimeCoverage(turns: readonly AuditTurn[]): TimeCoverage {
  let calls = 0;
  let withTime = 0;
  let turnsWithCanonical = 0;
  let turnsCovered = 0;
  const missingTimeTurns: number[] = [];

  for (const turn of turns) {
    let turnHasCanonical = false;
    let turnHasTime = false;
    for (const call of turn.toolCalls) {
      if (!call.accepted || !CANONICAL_COMMIT_TOOLS.has(call.name)) continue;
      calls += 1;
      turnHasCanonical = true;
      if (topLevelTime(call.args).present) {
        withTime += 1;
        turnHasTime = true;
      }
    }
    if (turnHasCanonical) {
      turnsWithCanonical += 1;
      if (turnHasTime) turnsCovered += 1;
      else missingTimeTurns.push(turn.index);
    }
  }
  return {
    acceptedCanonicalCalls: calls,
    acceptedWithTime: withTime,
    callRatio: calls === 0 ? 1 : withTime / calls,
    turnsWithCanonical,
    turnsCovered,
    missingTimeTurns,
  };
}

export interface ToolUsageRow {
  name: string;
  calls: number;
  errors: number;
}

export function measureToolUsage(turns: readonly AuditTurn[]): ToolUsageRow[] {
  const rows = new Map<string, ToolUsageRow>();
  for (const turn of turns) {
    for (const call of turn.toolCalls) {
      let row = rows.get(call.name);
      if (row === undefined) {
        row = { name: call.name, calls: 0, errors: 0 };
        rows.set(call.name, row);
      }
      row.calls += 1;
      if (!call.accepted) row.errors += 1;
    }
  }
  return [...rows.values()].toSorted((a, b) => b.calls - a.calls);
}

export interface GetStatusUsage {
  calls: number;
  /** 上一次 get_status 之后没有任何 state-changing accepted 工具就再次调用的次数 */
  redundant: number;
  redundancyRatio: number;
}

export function measureGetStatusUsage(turns: readonly AuditTurn[]): GetStatusUsage {
  let calls = 0;
  let redundant = 0;
  let stateChangedSinceStatus = true; // session 开头第一次 get_status 不算冗余
  for (const turn of turns) {
    for (const call of turn.toolCalls) {
      if (call.name === "get_status") {
        calls += 1;
        if (!stateChangedSinceStatus) redundant += 1;
        stateChangedSinceStatus = false;
        continue;
      }
      if (call.accepted && !READ_ONLY_TOOLS.has(call.name)) {
        stateChangedSinceStatus = true;
      }
    }
  }
  return { calls, redundant, redundancyRatio: calls === 0 ? 0 : redundant / calls };
}

/**
 * 代价信号启发式：本轮是否对玩家产生了机械可见的压力/损耗。
 * 覆盖：战斗裁决、伤势/状态恶化、actor 退场、花钱/负债、新增威胁。
 * 纯叙事压力（台词威胁、气氛）不计——这正是要量化的「软」。
 */
function turnHasCost(turn: AuditTurn): boolean {
  for (const call of turn.toolCalls) {
    if (!call.accepted) continue;
    if (
      call.name === "resolve_combat" ||
      call.name === "update_actor_condition" ||
      call.name === "retire_actor"
    ) {
      return true;
    }
    const serialized = JSON.stringify(call.args ?? null);
    if (call.name === "update_economy" && /"(?:spend-money|add-debt)"/.test(serialized))
      return true;
    if (CANONICAL_COMMIT_TOOLS.has(call.name) && serialized.includes('"add-threat"')) return true;
  }
  return false;
}

export interface PressureReport {
  noCostTurns: number;
  longestStreak: number;
  /** 全部无代价连续段长度（>=1） */
  streaks: number[];
}

export function measurePressure(turns: readonly AuditTurn[]): PressureReport {
  const streaks: number[] = [];
  let run = 0;
  let noCostTurns = 0;
  for (const turn of turns) {
    if (turnHasCost(turn)) {
      if (run > 0) streaks.push(run);
      run = 0;
    } else {
      noCostTurns += 1;
      run += 1;
    }
  }
  if (run > 0) streaks.push(run);
  return {
    noCostTurns,
    longestStreak: streaks.reduce((max, s) => Math.max(max, s), 0),
    streaks,
  };
}

export interface LintReport {
  findingsByRule: Record<string, number>;
  turnsWithFindings: number;
  blockFindings: Array<{ turn: number; finding: LintFinding }>;
}

export function measureLint(turns: readonly AuditTurn[]): LintReport {
  const findingsByRule: Record<string, number> = {};
  const blockFindings: LintReport["blockFindings"] = [];
  let turnsWithFindings = 0;

  for (const turn of turns) {
    const findings: LintFinding[] = [];
    if (turn.finalProse.trim().length > 0) {
      findings.push(...lintFinalProse(turn.finalProse));
      const lengthContext = proseLengthContextForTurn(turn);
      if (lengthContext !== undefined) {
        findings.push(...lintProseLength(turn.finalProse, lengthContext));
      }
    }
    // 秘密泄漏扫全轮文本：中间叙述泄漏同样致命
    findings.push(...findSecretLeaks(turn.fullText, turn.unrevealedSecrets));

    if (findings.length > 0) turnsWithFindings += 1;
    for (const finding of findings) {
      findingsByRule[finding.ruleId] = (findingsByRule[finding.ruleId] ?? 0) + 1;
      if (finding.severity === "block") blockFindings.push({ turn: turn.index, finding });
    }
  }
  return { findingsByRule, turnsWithFindings, blockFindings };
}

function proseLengthContextForTurn(turn: AuditTurn): ProseLengthContext | undefined {
  for (let index = turn.toolCalls.length - 1; index >= 0; index--) {
    const call = turn.toolCalls[index];
    if (call?.accepted !== true || call.name !== "submit_direction_packet") {
      continue;
    }
    const context = proseLengthContextFromPacket(call.args);
    if (context !== undefined) {
      return context;
    }
  }
  return undefined;
}

/** parallel-line 触发条件（gm-tool-policy）：>=30min 推进 / beat complete / 连续 2 轮无代价 */
const PARALLEL_LINE_TRIGGER_MINUTES = 30;

export interface ParallelLineReport {
  calls: number;
  triggeredTurns: number;
  /** 触发轮中，本轮或下一轮内调用了 parallel-line 的数量 */
  triggeredTurnsWithCall: number;
  hitRatio: number;
}

function isParallelLineCall(call: AuditToolCall): boolean {
  // 现行：引擎直接 fork 后台导演的 GM 工具 run_parallel_line（见 ADR 0005）。
  if (call.name === "run_parallel_line") return true;
  // 旧同步子代理（已废弃，仅为审计历史 session 保留）。
  return call.name === "subagent" && isRecord(call.args) && call.args["agent"] === "parallel-line";
}

export function measureParallelLine(turns: readonly AuditTurn[]): ParallelLineReport {
  const hasCall = turns.map((turn) => turn.toolCalls.some(isParallelLineCall));
  const calls = turns.reduce(
    (sum, turn) => sum + turn.toolCalls.filter(isParallelLineCall).length,
    0,
  );

  let triggeredTurns = 0;
  let triggeredTurnsWithCall = 0;
  let noCostRun = 0;

  turns.forEach((turn, i) => {
    let elapsed = 0;
    let beatComplete = false;
    for (const call of turn.toolCalls) {
      if (!call.accepted || !CANONICAL_COMMIT_TOOLS.has(call.name)) continue;
      elapsed += topLevelTime(call.args).elapsedMinutes;
      if (
        call.name === "progress_scene_beat" &&
        isRecord(call.args) &&
        call.args["kind"] === "complete"
      ) {
        beatComplete = true;
      }
      // 新格式：commit_turn 里 scene.complete-beat
      if (
        call.name === "commit_turn" &&
        isRecord(call.args) &&
        Array.isArray(call.args["events"]) &&
        call.args["events"].some(
          (entry: unknown) =>
            isRecord(entry) &&
            entry["kind"] === "scene" &&
            isRecord(entry["event"]) &&
            entry["event"]["kind"] === "complete-beat",
        )
      ) {
        beatComplete = true;
      }
    }
    noCostRun = turnHasCost(turn) ? 0 : noCostRun + 1;

    const triggered = elapsed >= PARALLEL_LINE_TRIGGER_MINUTES || beatComplete || noCostRun >= 2;
    if (!triggered) return;
    triggeredTurns += 1;
    if (hasCall[i] === true || hasCall[i + 1] === true) triggeredTurnsWithCall += 1;
  });

  return {
    calls,
    triggeredTurns,
    triggeredTurnsWithCall,
    hitRatio: triggeredTurns === 0 ? 1 : triggeredTurnsWithCall / triggeredTurns,
  };
}

// ---------- backstage 义务账本（引擎实账，schema v17+）----------

/**
 * `measureParallelLine` 是「按 tool-call 推断 GM 该不该推进后台」的启发式。
 * v17 硬阻断落地后，引擎自己在 `secrets.backstageReviewLog` / `backstageObligations`
 * 里记了实账——触发的义务必被结算才能继续。这里直接读实账，给出 ground truth：
 * 结算了多少、按 outcome/reasonCode 分布、结束时还欠多少。
 *
 * 新的「软」信号是 `nonLandedRatio`：硬阻断逼着 GM 清账，但 GM 可能用
 * `resolve_backstage_line` 的 no-change 橡皮图章绕过，而非真的 manage_undercurrent 落地。
 */
export interface BackstageLedgerReport {
  /** reviewLog 中已结算的义务数（landed + no-change + blocked） */
  reviewed: number;
  /** 按 outcome 分布 */
  byOutcome: Record<string, number>;
  /** 按 reasonCode 分布 */
  byReasonCode: Record<string, number>;
  /** session 结束时仍未结算的义务数 */
  openAtEnd: number;
  /** 仍未结算义务的 trigger 列表 */
  openTriggers: string[];
  /** 已结算中 outcome 非 landed（no-change/blocked）的占比——敷衍率 */
  nonLandedRatio: number;
}

function readLedgerArray(secrets: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(secrets)) return [];
  const value = secrets[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

/**
 * active path 上最后一个 domain-state 快照的 `secrets`（最新引擎账本所在）。
 * 老 schema（无 backstage 字段）返回的对象里读不到，measure 会安全降级为空账本。
 */
export function extractLatestSecrets(path: readonly RawEntry[]): unknown {
  let secrets: unknown;
  for (const entry of path) {
    if (entry.type === "custom" && entry.customType === "domain-state" && isRecord(entry.data)) {
      const state = entry.data["state"];
      if (isRecord(state)) secrets = state["secrets"];
    }
  }
  return secrets;
}

export function measureBackstageLedger(secrets: unknown): BackstageLedgerReport {
  const reviewLog = readLedgerArray(secrets, "backstageReviewLog");
  const obligations = readLedgerArray(secrets, "backstageObligations");

  const byOutcome: Record<string, number> = {};
  const byReasonCode: Record<string, number> = {};
  let nonLanded = 0;
  for (const entry of reviewLog) {
    const outcome = typeof entry["outcome"] === "string" ? entry["outcome"] : "unknown";
    const reasonCode = typeof entry["reasonCode"] === "string" ? entry["reasonCode"] : "unknown";
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
    byReasonCode[reasonCode] = (byReasonCode[reasonCode] ?? 0) + 1;
    if (outcome !== "landed") nonLanded += 1;
  }
  const openTriggers = obligations.map((entry) =>
    typeof entry["trigger"] === "string" ? entry["trigger"] : "unknown",
  );

  return {
    reviewed: reviewLog.length,
    byOutcome,
    byReasonCode,
    openAtEnd: obligations.length,
    openTriggers,
    nonLandedRatio: reviewLog.length === 0 ? 0 : nonLanded / reviewLog.length,
  };
}

// ---------- 汇总 ----------

export interface SessionAuditReport {
  turnCount: number;
  timeCoverage: TimeCoverage;
  toolUsage: ToolUsageRow[];
  getStatus: GetStatusUsage;
  pressure: PressureReport;
  lint: LintReport;
  parallelLine: ParallelLineReport;
  backstageLedger: BackstageLedgerReport;
}

export function auditSession(content: string): SessionAuditReport {
  const path = reconstructActivePath(parseSessionJsonl(content));
  const turns = groupTurns(path);
  return {
    turnCount: turns.length,
    timeCoverage: measureTimeCoverage(turns),
    toolUsage: measureToolUsage(turns),
    getStatus: measureGetStatusUsage(turns),
    pressure: measurePressure(turns),
    lint: measureLint(turns),
    parallelLine: measureParallelLine(turns),
    backstageLedger: measureBackstageLedger(extractLatestSecrets(path)),
  };
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function renderAuditReport(report: SessionAuditReport): string {
  const lines: string[] = [];
  lines.push(`turns: ${report.turnCount}`);

  const tc = report.timeCoverage;
  lines.push("");
  lines.push("[时间推进覆盖率]");
  lines.push(
    `  accepted canonical calls 带 time: ${tc.acceptedWithTime}/${tc.acceptedCanonicalCalls} (${percent(tc.callRatio)})`,
  );
  lines.push(`  覆盖轮: ${tc.turnsCovered}/${tc.turnsWithCanonical}`);
  if (tc.missingTimeTurns.length > 0) {
    lines.push(`  缺 time 的轮: ${tc.missingTimeTurns.join(", ")}`);
  }

  lines.push("");
  lines.push("[工具调用分布]");
  for (const row of report.toolUsage) {
    lines.push(`  ${row.name}: ${row.calls}${row.errors > 0 ? ` (errors: ${row.errors})` : ""}`);
  }

  const gs = report.getStatus;
  lines.push("");
  lines.push("[get_status]");
  lines.push(`  调用 ${gs.calls} 次，冗余 ${gs.redundant} 次 (${percent(gs.redundancyRatio)})`);

  const pr = report.pressure;
  lines.push("");
  lines.push("[压力纪律]");
  lines.push(`  无代价轮: ${pr.noCostTurns}/${report.turnCount}，最长连续 ${pr.longestStreak}`);
  if (pr.streaks.length > 0) lines.push(`  连续段分布: ${pr.streaks.join(", ")}`);

  const lint = report.lint;
  lines.push("");
  lines.push("[输出契约违规]");
  lines.push(`  有违规的轮: ${lint.turnsWithFindings}/${report.turnCount}`);
  const ruleEntries = Object.entries(lint.findingsByRule).toSorted((a, b) => b[1] - a[1]);
  for (const [ruleId, count] of ruleEntries) lines.push(`  ${ruleId}: ${count}`);
  for (const block of lint.blockFindings) {
    lines.push(
      `  !! turn ${block.turn} 泄漏未揭示秘密「${block.finding.match}」: ${block.finding.excerpt}`,
    );
  }

  const pl = report.parallelLine;
  lines.push("");
  lines.push("[parallel-line 触发启发式（按 tool-call 推断）]");
  lines.push(`  调用 ${pl.calls} 次`);
  lines.push(
    `  触发条件命中轮 ${pl.triggeredTurns}，其中调用了 parallel-line: ${pl.triggeredTurnsWithCall} (${percent(pl.hitRatio)})`,
  );

  const bl = report.backstageLedger;
  lines.push("");
  lines.push("[backstage 义务账本（引擎实账）]");
  lines.push(`  已结算义务: ${bl.reviewed}，session 结束仍未清账: ${bl.openAtEnd}`);
  if (bl.openTriggers.length > 0) {
    lines.push(`  未清账 trigger: ${bl.openTriggers.join(", ")}`);
  }
  if (bl.reviewed > 0) {
    const outcomes = Object.entries(bl.byOutcome).toSorted((a, b) => b[1] - a[1]);
    lines.push(`  outcome: ${outcomes.map(([key, count]) => `${key} ${count}`).join(" / ")}`);
    lines.push(`  非 landed（敷衍）占比: ${percent(bl.nonLandedRatio)}`);
    const reasons = Object.entries(bl.byReasonCode).toSorted((a, b) => b[1] - a[1]);
    lines.push(`  reasonCode: ${reasons.map(([key, count]) => `${key} ${count}`).join(" / ")}`);
  }

  return lines.join("\n");
}
