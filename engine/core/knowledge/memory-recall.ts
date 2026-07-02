/**
 * Campaign memory 检索引擎（backlog #6b）。
 *
 * 无向量、无外部依赖——纯关键词/actor/地点/scope 过滤即可。
 * eventLog + pinnedFacts + dailySummaries 全量可搜。
 */

import type {
  CampaignMemory,
  DailyEventMemory,
  DailySummaryMemory,
  MajorEventMemory,
  MemoryFact,
  State,
} from "../state/state.ts";

export interface RecallMemoryQuery {
  /** 关键词搜索（中英文均可，空格分词 OR 语义） */
  keywords?: string[];
  /** 按 actorId 过滤（pinnedFacts.subject 或 eventLog 全文匹配） */
  actorId?: string;
  /** 按地点关键词过滤 */
  location?: string;
  /** 按 scope 过滤（仅 pinnedFacts） */
  scope?: string;
  /** 最多返回条数 */
  limit?: number;
}

export interface RecallMemoryResult {
  pinnedFacts: MemoryFact[];
  events: MajorEventMemory[];
  dailyEvents: DailyEventMemory[];
  dailySummaries: DailySummaryMemory[];
  totalMatches: number;
}

const DEFAULT_LIMIT = 8;

export function recallMemory(state: State, query: RecallMemoryQuery): RecallMemoryResult {
  const memory = state.public.memory;
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), 20);

  const matchedFacts = filterPinnedFacts(memory, query);
  const matchedEvents = filterEvents(memory, query);
  const matchedDailyEvents = filterDailyEvents(memory, query);
  const matchedSummaries = filterSummaries(memory, query);

  const totalMatches =
    matchedFacts.length +
    matchedEvents.length +
    matchedDailyEvents.length +
    matchedSummaries.length;

  return {
    pinnedFacts: matchedFacts.slice(-limit),
    events: matchedEvents.slice(-limit),
    dailyEvents: matchedDailyEvents.slice(-limit),
    dailySummaries: matchedSummaries.slice(-limit),
    totalMatches,
  };
}

function filterDailyEvents(memory: CampaignMemory, query: RecallMemoryQuery): DailyEventMemory[] {
  return memory.dailyEvents.filter((event) => matchesDailyEvent(event, query));
}

function matchesDailyEvent(event: DailyEventMemory, query: RecallMemoryQuery): boolean {
  const haystack = `${event.title} ${event.summary}`;
  if (query.actorId !== undefined && !matchesText(haystack, query.actorId)) {
    return false;
  }
  return matchesKeywords(haystack, query);
}

function filterPinnedFacts(memory: CampaignMemory, query: RecallMemoryQuery): MemoryFact[] {
  return memory.pinnedFacts.filter((fact) => matchesPinnedFact(fact, query));
}

function matchesPinnedFact(fact: MemoryFact, query: RecallMemoryQuery): boolean {
  if (query.scope !== undefined && fact.scope !== query.scope) {
    return false;
  }
  if (query.actorId !== undefined && !matchesText(fact.subject, query.actorId)) {
    return false;
  }
  return matchesKeywords(`${fact.subject} ${fact.text}`, query);
}

function filterEvents(memory: CampaignMemory, query: RecallMemoryQuery): MajorEventMemory[] {
  return memory.eventLog.filter((event) => matchesEvent(event, query));
}

function matchesEvent(event: MajorEventMemory, query: RecallMemoryQuery): boolean {
  const claimTexts = (event.claims ?? []).map((c) => c.statement).join(" ");
  const haystack = `${event.title} ${event.summary} ${event.consequences.join(" ")} ${claimTexts}`;
  if (query.actorId !== undefined && !matchesText(haystack, query.actorId)) {
    return false;
  }
  return matchesKeywords(haystack, query);
}

function filterSummaries(memory: CampaignMemory, query: RecallMemoryQuery): DailySummaryMemory[] {
  return memory.dailySummaries.filter((summary) => matchesSummary(summary, query));
}

function matchesSummary(summary: DailySummaryMemory, query: RecallMemoryQuery): boolean {
  const haystack = summary.summary;
  if (query.actorId !== undefined && !matchesText(haystack, query.actorId)) {
    return false;
  }
  return matchesKeywords(haystack, query);
}

function matchesKeywords(haystack: string, query: RecallMemoryQuery): boolean {
  const keywords = query.keywords;
  const location = query.location;
  // 如果没有任何关键词和地点过滤，返回全部
  if ((keywords === undefined || keywords.length === 0) && location === undefined) {
    return true;
  }
  const lowerHaystack = haystack.toLowerCase();
  // location 是 AND 条件
  if (location !== undefined && !lowerHaystack.includes(location.toLowerCase())) {
    return false;
  }
  // keywords 是 OR 条件（任何一个匹配即可）
  if (keywords !== undefined && keywords.length > 0) {
    return keywords.some((keyword) => lowerHaystack.includes(keyword.toLowerCase()));
  }
  return true;
}

function matchesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
