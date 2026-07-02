import type { Static } from "typebox";

import { Type } from "typebox";

/**
 * Campaign 链路字符串枚举的单一事实来源。
 *
 * 每个枚举只在这里的 values 数组写一遍，同时驱动三个消费方：
 * - TS 类型：经 Static<> 推导，由 state.ts 以原名 re-export，消费方零改动；
 * - TypeBox schema：JSON Schema enum 关键字，走 typebox-validation.ts 的
 *   中文报错（"必须是允许值之一: ..."）；
 * - 运行时允许值数组：assertState 与工具边界直接复用。
 *
 * 注意 tools/registry.ts 的 parameters schema 故意保持松（枚举写在
 * description 里），不从这里引用——那一层是 LLM-facing 文档，职责不同。
 */
export function stringEnumSchema<const T extends readonly string[]>(values: T) {
  return Type.Unsafe<T[number]>({ enum: [...values] });
}

// ---------------------------------------------------------------------------
// Rule Sets — LOTM 规则集
// ---------------------------------------------------------------------------

export const RULE_SET_IDS = [
  "lotm-worldview-filter",
  "lotm-judgment-combat",
  "lotm-economy",
  "lotm-sequence-promotion",
  "custom",
] as const;
export const RULE_SET_ID_SCHEMA = stringEnumSchema(RULE_SET_IDS);
export type RuleSetId = Static<typeof RULE_SET_ID_SCHEMA>;

// ---------------------------------------------------------------------------
// Timelines — LOTM 世界线
// ---------------------------------------------------------------------------

export const TIMELINE_IDS = [
  "tingen",
  "backlund",
  "bayam",
  "condat",
  "fifth-epoch-1349",
  "custom",
] as const;
export const TIMELINE_ID_SCHEMA = stringEnumSchema(TIMELINE_IDS);
export type TimelineId = Static<typeof TIMELINE_ID_SCHEMA>;

// ---------------------------------------------------------------------------
// Time Zones — 保留 ISO timezone 框架，LOTM 世界内用固定时区
// ---------------------------------------------------------------------------

export const TIMEZONE_IDS = ["UTC"] as const;
export const TIMEZONE_ID_SCHEMA = stringEnumSchema(TIMEZONE_IDS);
export type TimeZoneId = Static<typeof TIMEZONE_ID_SCHEMA>;

// ---------------------------------------------------------------------------
// Currency — LOTM 货币（便士 / 金镑）
// ---------------------------------------------------------------------------

export const CURRENCY_CODES = ["penny", "gold-pound", "custom"] as const;
export const CURRENCY_CODE_SCHEMA = stringEnumSchema(CURRENCY_CODES);
export type CurrencyCode = Static<typeof CURRENCY_CODE_SCHEMA>;

// ---------------------------------------------------------------------------
// Opening Modes
// ---------------------------------------------------------------------------

export const OPENING_MODES = ["random", "selected", "custom"] as const;
export const OPENING_MODE_SCHEMA = stringEnumSchema(OPENING_MODES);
export type OpeningMode = Static<typeof OPENING_MODE_SCHEMA>;

// ---------------------------------------------------------------------------
// Boundary Kinds — LOTM 场景边界
// ---------------------------------------------------------------------------

export const BOUNDARY_KINDS = ["normal", "sacred-domain", "otherworld", "sealed"] as const;
export const BOUNDARY_KIND_SCHEMA = stringEnumSchema(BOUNDARY_KINDS);
export type BoundaryKind = Static<typeof BOUNDARY_KIND_SCHEMA>;

// ---------------------------------------------------------------------------
// Situation Kinds — LOTM 场景类型
// ---------------------------------------------------------------------------

export const SITUATION_KINDS = [
  "daily",
  "investigation",
  "social",
  "combat",
  "ritual",
  "escape",
  "downtime",
] as const;
export const SITUATION_KIND_SCHEMA = stringEnumSchema(SITUATION_KINDS);
export type SituationKind = Static<typeof SITUATION_KIND_SCHEMA>;

// ---------------------------------------------------------------------------
// Purse Access
// ---------------------------------------------------------------------------

export const PURSE_ACCESSES = ["held", "shared", "requires-permission"] as const;
export const PURSE_ACCESS_SCHEMA = stringEnumSchema(PURSE_ACCESSES);
export type PurseAccess = Static<typeof PURSE_ACCESS_SCHEMA>;

// ---------------------------------------------------------------------------
// Memory Scopes
// ---------------------------------------------------------------------------

export const MEMORY_SCOPES = ["protagonist", "npc", "faction", "world"] as const;
export const MEMORY_SCOPE_SCHEMA = stringEnumSchema(MEMORY_SCOPES);
export type MemoryFactScope = Static<typeof MEMORY_SCOPE_SCHEMA>;

// ---------------------------------------------------------------------------
// Reveal Statuses — 通用揭示状态
// ---------------------------------------------------------------------------

export const REVEAL_STATUSES = ["hidden", "suspected", "revealed"] as const;
export const REVEAL_STATUS_SCHEMA = stringEnumSchema(REVEAL_STATUSES);
export type RevealStatus = Static<typeof REVEAL_STATUS_SCHEMA>;


// ---------------------------------------------------------------------------
// Actor — LOTM 角色类型
// ---------------------------------------------------------------------------

export const ACTOR_KINDS = ["human", "beyonder", "creature", "other"] as const;
export const ACTOR_KIND_SCHEMA = stringEnumSchema(ACTOR_KINDS);
export type ActorKind = Static<typeof ACTOR_KIND_SCHEMA>;

export const ACTOR_STANCES = [
  "self",
  "ally",
  "friendly",
  "neutral",
  "wary",
  "hostile",
  "unknown",
] as const;
export const ACTOR_STANCE_SCHEMA = stringEnumSchema(ACTOR_STANCES);
export type ActorStance = Static<typeof ACTOR_STANCE_SCHEMA>;

// ---------------------------------------------------------------------------
// Pathway — LOTM 32 条途径（22 标准 + 10 外神/非标准）
// 中文名对照见 pathway-names.ts
// ---------------------------------------------------------------------------

export const PATHWAY_IDS = [
  // —— 22 条标准途径 ——
  "seer", // 占卜家
  "apprentice", // 学徒
  "marauder", // 偷盗者
  "spectator", // 观众
  "bard", // 歌颂者
  "sailor", // 水手
  "reader", // 阅读者
  "secrets-suppliant", // 秘祈人
  "sleepless", // 不眠者
  "corpse-collector", // 收尸人
  "warrior", // 战士
  "mystery-pryer", // 窥秘人
  "savant", // 通识者
  "hunter", // 猎人
  "assassin", // 刺客
  "apothecary", // 药师
  "planter", // 耕种者
  "lawyer", // 律师
  "arbiter", // 仲裁人
  "prisoner", // 囚犯
  "criminal", // 罪犯
  "monster", // 怪物
  // —— 10 条外神/非标准途径 ——
  "dancer", // 舞蹈家（宿命）
  "villain", // 恶棍（堕落母神）
  "patient", // 病患（衰败君王）
  "scrooge", // 吝啬鬼（欲望母树）
  "broker", // 掮客（不定之雾）
  "astronomy-aficionado", // 天文爱好者（超星主宰）
  "tramp", // 流浪汉（原初饥饿）
  "dreamless", // 失梦人（命运女神）
  "babbler", // 入门者（不熄的唠叨者）
  "prayermonger", // 萨满（高维外神衍生）
  "custom",
] as const;
export const PATHWAY_ID_SCHEMA = stringEnumSchema(PATHWAY_IDS);
export type PathwayId = Static<typeof PATHWAY_ID_SCHEMA>;

// ---------------------------------------------------------------------------
// Sequence Rank — LOTM 序列等级
// ---------------------------------------------------------------------------

export const SEQUENCE_RANKS = [
  "seq-9",
  "seq-8",
  "seq-7",
  "seq-6",
  "seq-5",
  "seq-4",
  "seq-3",
  "seq-2",
  "seq-1",
  "seq-0",
  "old-one", // 旧日
  "pillar", // 支柱
  "ordinary", // 普通人
] as const;
export const SEQUENCE_RANK_SCHEMA = stringEnumSchema(SEQUENCE_RANKS);
export type SequenceRank = Static<typeof SEQUENCE_RANK_SCHEMA>;



// ---------------------------------------------------------------------------
// Promotion System — LOTM 晋升体系
// ---------------------------------------------------------------------------

export const PROMOTION_SYSTEMS = ["potion", "other"] as const;
export const PROMOTION_SYSTEM_SCHEMA = stringEnumSchema(PROMOTION_SYSTEMS);
export type PromotionSystem = Static<typeof PROMOTION_SYSTEM_SCHEMA>;

// ---------------------------------------------------------------------------
// Tracked Items — LOTM 物品类型
// ---------------------------------------------------------------------------

export const TRACKED_ITEM_KINDS = [
  "mundane",
  "weapon",
  "sealed-artifact", // 封印物
  "mystical-item", // 非凡物品
  "document",
  "key-item",
  "consumable",
  "other",
] as const;
export const TRACKED_ITEM_KIND_SCHEMA = stringEnumSchema(TRACKED_ITEM_KINDS);
export type TrackedItemKind = Static<typeof TRACKED_ITEM_KIND_SCHEMA>;

export const TRACKED_ITEM_CONDITIONS = ["intact", "damaged", "broken", "spent", "unknown"] as const;
export const TRACKED_ITEM_CONDITION_SCHEMA = stringEnumSchema(TRACKED_ITEM_CONDITIONS);
export type TrackedItemCondition = Static<typeof TRACKED_ITEM_CONDITION_SCHEMA>;

export const TRACKED_ITEM_VISIBILITIES = ["player-known", "suspected"] as const;
export const TRACKED_ITEM_VISIBILITY_SCHEMA = stringEnumSchema(TRACKED_ITEM_VISIBILITIES);
export type TrackedItemVisibility = Static<typeof TRACKED_ITEM_VISIBILITY_SCHEMA>;

// ---------------------------------------------------------------------------
// Scene Threat Severity
// ---------------------------------------------------------------------------

export const SCENE_THREAT_SEVERITIES = ["low", "medium", "high", "lethal"] as const;
export const SCENE_THREAT_SEVERITY_SCHEMA = stringEnumSchema(SCENE_THREAT_SEVERITIES);

// ---------------------------------------------------------------------------
// Acting — 扮演消化维度
// ---------------------------------------------------------------------------

export const INTENSITY_LEVELS = ["cursory", "moderate", "deep", "pivotal"] as const;
export const INTENSITY_LEVEL_SCHEMA = stringEnumSchema(INTENSITY_LEVELS);
export type IntensityLevel = Static<typeof INTENSITY_LEVEL_SCHEMA>;

export const NARRATIVE_WEIGHT_LEVELS = ["casual", "witnessed", "significant", "fateful"] as const;
export const NARRATIVE_WEIGHT_LEVEL_SCHEMA = stringEnumSchema(NARRATIVE_WEIGHT_LEVELS);
export type NarrativeWeightLevel = Static<typeof NARRATIVE_WEIGHT_LEVEL_SCHEMA>;
export type SceneThreatSeverity = Static<typeof SCENE_THREAT_SEVERITY_SCHEMA>;


