/**
 * Ability lookup engine — loads data/abilities/pathway_abilities.json
 * and provides formatted query for sequence abilities.
 *
 * Query modes:
 *   1. Sequence name: "秘偶大师" → find pathway + rank, show cumulative chain
 *   2. Pathway-rank:  "占卜家途径-序列5" → direct, show cumulative chain
 *
 * only=true → show only the target rank's abilities, no chain.
 */

import type { PathwayId, PublicActorState, SequenceRank, State } from "../../core/state/state.ts";

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PATHWAY_DISPLAY_NAMES, RANK_DISPLAY_NAMES } from "../../core/state/pathway-names.ts";
import { createId } from "../../core/utils/ids.ts";

// ===========================================================================
// Types
// ===========================================================================

interface AbilityEntry {
  name: string;
  description: string;
  type: string;
  sequenceName: string;
}

interface ParsedQuery {
  pathway: string;
  rank: string;
  only: boolean;
}

export interface AbilityLookupResult {
  text: string;
}

/** pathway → rank → abilities */
type PathwayIndex = Record<string, Record<string, AbilityEntry[]>>;
/** sequence name → { pathway, rank } */
type SeqNameIndex = Record<string, { pathway: string; rank: string }>;

// ===========================================================================
// Constants
// ===========================================================================

const RANK_ORDER: readonly string[] = [
  "序列9",
  "序列8",
  "序列7",
  "序列6",
  "序列5",
  "序列4",
  "序列3",
  "序列2",
  "序列1",
  "序列0",
  "支柱",
  "旧日",
];

const PATHWAY_RANK_RE = /^(.+?)途径-(序列\d+|支柱|旧日)$/;

// Data loading
// ===========================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABILITIES_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "data",
  "abilities",
  "pathway_abilities.json",
);
type RawData = Record<string, AbilityEntry[]>;

let cachedRaw: RawData | null = null;
let cachedPathwayIndex: PathwayIndex | null = null;
let cachedSeqNameIndex: SeqNameIndex | null = null;

function isRawData(value: unknown): value is RawData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadRaw(): RawData {
  if (cachedRaw === null) {
    const parsed = JSON.parse(readFileSync(ABILITIES_PATH, "utf-8"));
    if (!isRawData(parsed)) {
      throw new Error("ability-lookup: 解析 pathway_abilities.json 后类型不匹配，预期为对象");
    }
    cachedRaw = parsed;
  }
  return cachedRaw;
}

function buildIndexes(): {
  pathwayIndex: PathwayIndex;
  seqNameIndex: SeqNameIndex;
} {
  if (cachedPathwayIndex !== null && cachedSeqNameIndex !== null) {
    return { pathwayIndex: cachedPathwayIndex, seqNameIndex: cachedSeqNameIndex };
  }

  const raw = loadRaw();
  const pathIdx: PathwayIndex = {};
  const seqIdx: SeqNameIndex = {};

  for (const [key, entries] of Object.entries(raw)) {
    const match = key.match(PATHWAY_RANK_RE);
    if (match === null) continue;

    const pathway = match[1]!;
    const displayRank = match[2]!;

    let rankMap = pathIdx[pathway];
    if (rankMap === undefined) {
      rankMap = {};
      pathIdx[pathway] = rankMap;
    }
    rankMap[displayRank] = entries;

    for (const entry of entries) {
      if (seqIdx[entry.sequenceName] === undefined) {
        seqIdx[entry.sequenceName] = { pathway, rank: displayRank };
      }
    }
  }

  cachedPathwayIndex = pathIdx;
  cachedSeqNameIndex = seqIdx;
  return { pathwayIndex: pathIdx, seqNameIndex: seqIdx };
}

// ===========================================================================
// Query parsing
// ===========================================================================

/**
 * Parse a raw query string into a structured ability query.
 * Supports:
 *   - "占卜家途径-序列5"    (pathway-rank pattern)
 *   - "秘偶大师"           (sequence name, auto-resolved)
 *
 * Returns null when neither pattern matches.
 */
export function parseAbilityQuery(raw: string, only = false): ParsedQuery | null {
  const pathMatch = raw.match(PATHWAY_RANK_RE);
  if (pathMatch) {
    return { pathway: pathMatch[1]!, rank: pathMatch[2]!, only };
  }

  const { seqNameIndex } = buildIndexes();
  const found = seqNameIndex[raw];
  if (found) {
    return { pathway: found.pathway, rank: found.rank, only };
  }

  return null;
}

// ===========================================================================
// Rank ordering
// ===========================================================================

const ORDER_MAP: Record<string, number> = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i]));

function rankIdx(rank: string): number {
  const idx = ORDER_MAP[rank];
  if (idx === undefined) throw new Error(`unknown rank: ${rank}`);
  return idx;
}

// ===========================================================================
// Formatting — single rank
// ===========================================================================

function formatSingle(
  pathway: string,
  rank: string,
  rankMap: Record<string, AbilityEntry[]>,
): string {
  const entries = rankMap[rank];
  if (entries === undefined || entries.length === 0) {
    return `【${pathway}途径 · ${rank}】无能力数据。`;
  }

  const seqName = entries[0]!.sequenceName;
  const lines: string[] = [`╔══ ${pathway}途径 — ${rank}：${seqName} ══╗\n`];

  for (const entry of entries) {
    lines.push(`【${entry.type}】${entry.name}`);
    lines.push(entry.description);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ===========================================================================
// Formatting — cumulative chain
// ===========================================================================

function formatCumulative(
  pathway: string,
  targetRank: string,
  targetIdx: number,
  rankMap: Record<string, AbilityEntry[]>,
): string {
  const targetName = rankMap[targetRank]?.[0]?.sequenceName ?? targetRank;
  const sep = "─".repeat(42);

  const lines: string[] = [
    `╔══ ${pathway}途径 — 能力链总览（目标${targetRank}：${targetName}） ══╗`,
    `║  下列能力自序列9起逐级累积，高序列对低序列能力有全面增强效果  ║`,
    `╚${sep}╝`,
    "",
  ];

  for (let i = 0; i <= targetIdx; i++) {
    const rank = RANK_ORDER[i]!;
    const entries = rankMap[rank];
    if (entries === undefined || entries.length === 0) continue;

    const seqName = entries[0]!.sequenceName;
    lines.push(`┌─ ${pathway}途径 · ${rank}：${seqName}`);

    if (i < targetIdx) {
      lines.push(`│  此序列及以下所有能力在晋升后获得全面增强`);
    }
    lines.push("│");

    for (const entry of entries) {
      const text = entry.description.replace(/\n/g, "\n│  ");
      lines.push(`│  【${entry.type}】${entry.name}`);
      lines.push(`│  ${text}`);
      lines.push("│");
    }

    lines.push("");
  }

  lines.push(sep);
  lines.push(
    `温馨提示：${targetName}（${targetRank}）拥有${pathway}途径序列9至${targetRank}的全部能力，`,
  );
  lines.push(`   且所有低序列能力均已获得全面增强（威力、精度、范围等均随序列提升而增长）。`);

  return lines.join("\n");
}

// ===========================================================================
// Query execution
// ===========================================================================

export function lookupAbility(query: ParsedQuery): AbilityLookupResult {
  const { pathwayIndex } = buildIndexes();
  const rankMap = pathwayIndex[query.pathway];
  if (rankMap === undefined) {
    return { text: `未找到途径「${query.pathway}」的能力数据。` };
  }

  const targetIdx = rankIdx(query.rank);

  if (query.only) {
    return { text: formatSingle(query.pathway, query.rank, rankMap) };
  }

  return { text: formatCumulative(query.pathway, query.rank, targetIdx, rankMap) };
}

/**
 * Parse and query in one call. Convenience for the lookup tool.
 */
export function lookupAbilities(raw: string, only = false): AbilityLookupResult {
  const parsed = parseAbilityQuery(raw, only);
  if (parsed === null) {
    return {
      text: [
        `无法解析能力查询："${raw}"。`,
        "",
        "支持的格式：",
        '  - 途径-序列："占卜家途径-序列5"',
        "    查询高序列会自动展示从序列9起全部低序列能力。",
        "    追加 only=true 只显示该序列能力，不展示累积链。",
        '  - 序列名：  "秘偶大师"、"占卜家"（自动识别所属途径）',
        '  - 能力名：  "占卜"（搜索所有途径中包含该名称的能力）',
      ].join("\n"),
    };
  }
  return lookupAbility(parsed);
}

/**
 * Search abilities by name (substring match). Returns null when nothing matches.
 * This is a fallback for when pathway-rank and sequence-name queries both fail.
 */
export function searchAbilitiesByName(raw: string): AbilityLookupResult | null {
  const data = loadRaw();
  const matches: Array<{ key: string; pathway: string; rank: string; entry: AbilityEntry }> = [];

  for (const [key, entries] of Object.entries(data)) {
    const match = key.match(PATHWAY_RANK_RE);
    if (match === null) continue;
    const pathway = match[1]!;
    const rank = match[2]!;

    for (const entry of entries) {
      if (entry.name.includes(raw)) {
        matches.push({ key, pathway, rank, entry });
      }
    }
  }

  if (matches.length === 0) return null;

  // Group by pathway-rank for display
  const grouped = new Map<string, { pathway: string; rank: string; entries: AbilityEntry[] }>();
  for (const m of matches) {
    const g = grouped.get(m.key);
    if (g) {
      g.entries.push(m.entry);
    } else {
      grouped.set(m.key, { pathway: m.pathway, rank: m.rank, entries: [m.entry] });
    }
  }

  const lines: string[] = [`找到以下包含「${raw}」的能力：`, ""];
  for (const [, g] of grouped) {
    const seqName = g.entries[0]!.sequenceName;
    lines.push(`╔══ ${g.pathway}途径 — ${g.rank}：${seqName} ══╗`);
    for (const entry of g.entries) {
      lines.push("");
      lines.push(`【${entry.type}】${entry.name}`);
      lines.push(entry.description);
    }
    lines.push("");
  }

  return { text: lines.join("\n").trimEnd() };
}

/** All indexed pathway names for discovery. */
export function listAbilityPathways(): string[] {
  const { pathwayIndex } = buildIndexes();
  return Object.keys(pathwayIndex).toSorted();
}

/** All indexed sequence names for discovery. */
export function listAbilitySequenceNames(): string[] {
  const { seqNameIndex } = buildIndexes();
  return Object.keys(seqNameIndex).toSorted();
}

/** 按 pathway 显示名 + rank 标签查询该序列的能力条目（结构化数据，供 promotion 工具直接消费） */
export function lookupStructuredAbilities(
  pathwayDisplayName: string,
  rankLabel: string,
): Array<{ name: string; description: string; type: string }> {
  const { pathwayIndex } = buildIndexes();
  const rankMap = pathwayIndex[pathwayDisplayName];
  if (rankMap === undefined) return [];
  return rankMap[rankLabel] ?? [];
}

/** 按 pathway 显示名 + 目标 rank 标签，返回序列9到该 rank 的累计能力条目 */
export function lookupCumulativeStructuredAbilities(
  pathwayDisplayName: string,
  targetRankLabel: string,
): Array<{ name: string; description: string; type: string }> {
  const { pathwayIndex } = buildIndexes();
  const rankMap = pathwayIndex[pathwayDisplayName];
  if (rankMap === undefined) return [];

  const targetIdx = RANK_ORDER.indexOf(targetRankLabel);
  if (targetIdx === -1) return [];

  const result: Array<{ name: string; description: string; type: string }> = [];
  for (let i = 0; i <= targetIdx; i++) {
    const rank = RANK_ORDER[i];
    if (rank === undefined) continue;
    const entries = rankMap[rank];
    if (entries !== undefined) {
      result.push(...entries);
    }
  }
  return result;
}

/**
 * 为 actor 分配从序列9到目标 rank 的累计能力，跳过已存在 label 的条目。
 * 返回值是本次新增的能力数。
 */
export function assignCumulativeAbilities(
  draft: State,
  actor: PublicActorState,
  pathway: PathwayId,
  targetRank: SequenceRank,
): number {
  const pathwayName = PATHWAY_DISPLAY_NAMES[pathway] ?? pathway;
  const rankLabel = RANK_DISPLAY_NAMES[targetRank] ?? targetRank;
  const allAbilities = lookupCumulativeStructuredAbilities(pathwayName, rankLabel);
  const existingLabels = new Set(actor.abilities.map((a) => a.label));
  let count = 0;
  for (const ability of allAbilities) {
    if (existingLabels.has(ability.name)) continue;
    actor.abilities.push({
      id: createId(draft, "ability"),
      label: ability.name,
      summary: ability.description,
    });
    count++;
  }
  return count;
}

export type { ParsedQuery as AbilityParsedQuery };
