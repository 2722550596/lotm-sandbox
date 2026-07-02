import type { Static } from "typebox";

import { Type } from "typebox";
import { Compile } from "typebox/compile";

import { SITUATION_KIND_SCHEMA, stringEnumSchema } from "../core/state/state-enum-schemas.ts";
import { isRecord, parseTypeBoxValue, trimStringsDeep } from "../core/utils/typebox-validation.ts";

/**
 * Direction Packet：双 pass 架构（backlog #12）中结算器 → 渲染器的唯一通道。
 * 接缝契约已由 docs/spike-two-pass/ 验证（GO）。
 *
 * 分层语义：
 * - binding（playerAction / resolvedChanges / endWindow / npcStances[].move）：渲染器必须落地，不得改写。
 * - free（sensoryAnchors / npcStances 的 stance·wants·refusesToSay）：质感建议，渲染器可自由取舍。
 * - needsRender=false 的轮（meta/OOC）跳过渲染，直接回复 directReply。
 */

export const EVENT_WEIGHTS = ["light", "normal", "heavy"] as const;
export type EventWeight = (typeof EVENT_WEIGHTS)[number];

export const NPC_STANCE_SCHEMA = Type.Object({
  actorId: Type.String({ minLength: 1 }),
  stance: Type.String({ minLength: 1 }),
  wants: Type.String({ minLength: 1 }),
  /**
   * binding：本轮该 NPC 为追求 wants 而「主动」说出/做出的一个具体行为——一句台词、
   * 一个要求、一个肢体动作。渲染器必须把它演成该 NPC 自己的主动 beat，不得下变换成
   * 「观望/小心行走/沉默不语」等被动反应，也不得只让其对玩家或环境做出回应。
   */
  move: Type.String({ minLength: 1 }),
  /** 该角色本轮绝不说出口的内容。只描述「拒说什么」，禁止把秘密本体写进来。 */
  refusesToSay: Type.String({ minLength: 1 }),
});
export type NpcStance = Static<typeof NPC_STANCE_SCHEMA>;

export const SUGGESTED_ACTION_SCHEMA = Type.Object({
  submitText: Type.String({ minLength: 1 }),
});
export type SuggestedAction = Static<typeof SUGGESTED_ACTION_SCHEMA>;

/** 重要在场 NPC 本轮不主动行动的结构化理由（枚举）。 */
export const NPC_OMISSION_REASON_CODES = [
  "offscreen",
  "unconscious",
  "physically-absent",
  "watching-silently",
  "blocked-by-threat",
  "not-relevant",
] as const;
export type NpcOmissionReasonCode = (typeof NPC_OMISSION_REASON_CODES)[number];

/**
 * 重要在场 NPC 的“本轮静置”声明（binding：渲染器不得把该 NPC 演成主动 beat）。
 * playerSafeNote 只描述玩家可感知的表象，禁止写入秘密本体（走 secret 防火墙）。
 */
export const NPC_OMISSION_SCHEMA = Type.Object({
  actorId: Type.String({ minLength: 1 }),
  reasonCode: stringEnumSchema(NPC_OMISSION_REASON_CODES),
  playerSafeNote: Type.String({ minLength: 1 }),
});
export type NpcOmission = Static<typeof NPC_OMISSION_SCHEMA>;

export const SCENE_TIME_SCHEMA = Type.Object({
  /** 格式化当前时间，如「第五纪1349年1月15日 星期二 14:30」 */
  display: Type.String({ minLength: 1 }),
  /** 本轮经过分钟数 */
  elapsedMinutes: Type.Integer(),
});
export type SceneTime = Static<typeof SCENE_TIME_SCHEMA>;

const ACTIVE_BEAT_SCHEMA = Type.Object({
  title: Type.String({ minLength: 1 }),
  objectives: Type.Array(Type.String({ minLength: 1 })),
  threats: Type.Array(Type.String({ minLength: 1 })),
});

export const SCENE_CONTEXT_SCHEMA = Type.Object({
  /** 地点文本，如「廷根市·霍伊大学·值夜者据点」 */
  location: Type.String({ minLength: 1 }),
  /** 态势 */
  situation: SITUATION_KIND_SCHEMA,
  /** 在场 actor 的 renderName 列表 */
  presentActors: Type.Array(Type.String({ minLength: 1 })),
  /** 仅在 beat 激活时出现 */
  beat: Type.Optional(ACTIVE_BEAT_SCHEMA),
});
export type SceneContext = Static<typeof SCENE_CONTEXT_SCHEMA>;

export const RENDER_DIRECTION_PACKET_SCHEMA = Type.Object({
  needsRender: Type.Literal(true),
  /** 结算后的玩家行动认定（binding） */
  playerAction: Type.String({ minLength: 1 }),
  /** 已结算机械事实，每条必须在正文落地（binding） */
  resolvedChanges: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  npcStances: Type.Optional(Type.Array(NPC_STANCE_SCHEMA)),
  /**
   * binding：重要在场 NPC 本轮不主动行动时的静置声明。每个重要在场 NPC 要么在
   * npcStances（有主动 beat），要么在 npcOmissions（被明确静置）；渲染器据此保持物理连续性。
   */
  npcOmissions: Type.Optional(Type.Array(NPC_OMISSION_SCHEMA)),
  /** 建议落点意象（free） */
  sensoryAnchors: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  /** 结尾必须落在自然接续点（binding） */
  endWindow: Type.String({ minLength: 1 }),
  eventWeight: stringEnumSchema(EVENT_WEIGHTS),
  /** 渲染所需 canon 预填；渲染器不得超出它编造原作设定 */
  canonFacts: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  /** UI 层候选行动，不进入正文；extension 可把 submitText 作为真正 user message 发出 */
  suggestedActions: Type.Optional(
    Type.Array(SUGGESTED_ACTION_SCHEMA, { minItems: 1, maxItems: 4 }),
  ),
  /** 渲染约束：渲染器不得写入或暗示的内容 */
  constraints: Type.Optional(
    Type.Object({
      forbiddenContent: Type.Array(Type.String({ minLength: 1 }), {
        description: "禁止写入的原文或意象列表；渲染器不得直接或暗示性地写入这些内容",
      }),
    }),
  ),
});
export type RenderDirectionPacket = Static<typeof RENDER_DIRECTION_PACKET_SCHEMA>;

export const DIRECT_REPLY_PACKET_SCHEMA = Type.Object({
  needsRender: Type.Literal(false),
  /** meta/OOC 轮直接回复玩家的内容，不经渲染器 */
  directReply: Type.String({ minLength: 1 }),
});
export type DirectReplyPacket = Static<typeof DIRECT_REPLY_PACKET_SCHEMA>;

export type DirectionPacket = RenderDirectionPacket | DirectReplyPacket;

const RENDER_PACKET_VALIDATOR = Compile(RENDER_DIRECTION_PACKET_SCHEMA);
const DIRECT_REPLY_VALIDATOR = Compile(DIRECT_REPLY_PACKET_SCHEMA);

export function parseDirectionPacket(value: unknown, fieldName: string): DirectionPacket {
  const trimmed = trimStringsDeep(value);
  if (!isRecord(trimmed)) {
    throw new Error(`${fieldName} 必须是对象。`);
  }
  const needsRender = trimmed["needsRender"];
  if (typeof needsRender !== "boolean") {
    throw new Error(`非法 ${fieldName}.needsRender: 必须是布尔值（true=渲染轮，false=直答轮）。`);
  }
  return needsRender
    ? parseTypeBoxValue(trimmed, fieldName, RENDER_PACKET_VALIDATOR)
    : parseTypeBoxValue(trimmed, fieldName, DIRECT_REPLY_VALIDATOR);
}
