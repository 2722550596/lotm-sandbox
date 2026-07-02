import type { DomainToolDefinition } from "../runtime/tool-definition.ts";

import { Type } from "typebox";

import { collectUnrevealedSecretStrings } from "../../audit/lint-rules.ts";
import { persistStateAfterCommit } from "../../core/state/session-persistence.ts";
import {
  stringEnumSchema,
  stringEnumSchema as omissionReasonSchema,
} from "../../core/state/state-enum-schemas.ts";
import { commitState, getState } from "../../core/state/state-store.ts";
import { scanDirectionPacket } from "../../direction/packet-firewall.ts";
import {
  type DirectionPacket,
  EVENT_WEIGHTS,
  NPC_OMISSION_REASON_CODES,
  parseDirectionPacket,
} from "../../direction/packet-schema.ts";
import {
  buildPacketValidationContext,
  validateRenderDirectionPacket,
} from "../../direction/packet-validation.ts";
import { SUBMIT_DIRECTION_PACKET_TOOL } from "../../direction/render-turn.ts";
import { textResult, type ToolResult } from "../runtime/tool-result.ts";

/**
 * 双 pass 收尾工具：验证 direction packet、过 secret 防火墙，terminate 结束
 * 结算循环；渲染由 two-pass-render 扩展在 agent_end 接手。本工具不改 state。
 */
export function submitDirectionPacketTool(
  params: unknown,
  sessionManager: unknown,
): ToolResult & { terminate: true } {
  const packet = parseDirectionPacket(params, "direction packet");
  const state = getState();
  if (packet.needsRender && !state.public.pendingDirectionPacket) {
    throw new Error(
      "叙事轮（needsRender=true）必须先调用 commit_turn 结算本轮状态变化，再调用 submit_direction_packet 输出叙事。没有状态结算的正文输出会导致状态与叙事脱节。meta/OOC 直答轮用 needsRender=false。",
    );
  }
  if (packet.needsRender) {
    validateRenderDirectionPacket(packet, buildPacketValidationContext(state));
  }
  const verdict = scanDirectionPacket(packet, collectUnrevealedSecretStrings(state.secrets));
  if (verdict.kind === "blocked") {
    const paths = verdict.findings
      .map((finding) => `${finding.path}（泄漏「${finding.secret}」）`)
      .join("、");
    throw new Error(
      `direction packet 被 secret 防火墙拦截：${paths}。` +
        "渲染器不得接触未揭示秘密；请改写这些字段，只描述玩家可感知的表象，或先用 reveal_secret 正式揭示。",
    );
  }
  state.public.pendingDirectionPacket = false;
  commitState(state);
  persistStateAfterCommit(sessionManager, { packet });
  return { ...textResult(formatAccepted(packet), { packet }), terminate: true };
}

function formatAccepted(packet: DirectionPacket): string {
  if (!packet.needsRender) {
    return "direction packet 已接收（直答轮）：directReply 将原样回复玩家。";
  }
  const suggestedActionCount = packet.suggestedActions?.length ?? 0;
  return [
    "direction packet 已接收并通过 secret 防火墙，本轮结算结束。",
    `binding 事实 ${packet.resolvedChanges.length} 条 / NPC 立场 ${packet.npcStances.length} 条 / UI 候选 ${suggestedActionCount} 条 / 篇幅 ${packet.eventWeight}。`,
    "渲染器将接手产出玩家可见正文。",
  ].join("\n");
}

export const submitDirectionPacketToolDefinition: DomainToolDefinition = {
  name: SUBMIT_DIRECTION_PACKET_TOOL,
  description:
    "提交本轮 direction packet 并结束结算；每轮唯一收尾动作。\n\n" +
    "使用边界：全部领域工具结算完成后调用；meta/OOC 轮用 needsRender=false + directReply 直接作答。\n" +
    "禁区：调用前后输出叙事正文、泄露未揭示序列途径/隐藏身份、替代领域工具落账，或把 UI 候选行动写进 suggestedActions 以外的位置。",
  parameters: Type.Object({
    needsRender: Type.Boolean({
      description: "true=叙事轮（渲染器产出正文）；false=meta/OOC 直答轮",
    }),
    playerAction: Type.Optional(
      Type.String({ description: "binding：结算后认定并主动演出的玩家意图（叙事轮必填）" }),
    ),
    resolvedChanges: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "binding：本轮全部已结算机械事实，每条一句话；漏写=玩家看不到（叙事轮必填，至少 1 条）",
      }),
    ),
    npcStances: Type.Optional(
      Type.Array(
        Type.Object({
          actorId: Type.String({ description: "在场 NPC 的 actor id；必须已存在于 public actors" }),
          stance: Type.String({ description: "行为基调" }),
          wants: Type.String({ description: "本轮驱动其主动行为的欲望" }),
          move: Type.String({
            description:
              "binding：本轮该 NPC 为追求 wants 而主动说出/做出的一个具体行为（一句台词/一个要求/一个肢体动作）；哪怕过场轮也要有。必须是该 NPC 自己的主动 beat，不是对玩家/环境的被动反应；缺位会让该 NPC 被渲染成被动布景",
          }),
          refusesToSay: Type.String({
            description: "绝不说出口的话题；只描述拒说什么，严禁写入秘密本体",
          }),
        }),
        { description: "player-safe：在场重要 NPC 每人一条主动 beat（叙事轮必填，可为空数组）" },
      ),
    ),
    npcOmissions: Type.Optional(
      Type.Array(
        Type.Object({
          actorId: Type.String({
            description: "被静置的在场 NPC 的 actor id；必须已存在且在 scene.presentActorIds",
          }),
          reasonCode: omissionReasonSchema(NPC_OMISSION_REASON_CODES),
          playerSafeNote: Type.String({
            description:
              "该 NPC 本轮不主动行动的玩家可感知表象（如『站在门口沉默旁观』）；严禁写入秘密本体",
          }),
        }),
        {
          description:
            "binding：重要在场 NPC 若本轮不主动行动，必须在此明确静置（reasonCode + playerSafeNote），否则会被渲染成被动布景",
        },
      ),
    ),
    sensoryAnchors: Type.Optional(
      Type.Array(Type.String(), { description: "free：3-5 条建议落点意象，渲染器可取舍" }),
    ),
    endWindow: Type.Optional(
      Type.String({ description: "binding：结尾必须落在自然接续点（叙事轮必填）" }),
    ),
    eventWeight: Type.Optional(stringEnumSchema(EVENT_WEIGHTS)),
    suggestedActions: Type.Optional(
      Type.Array(
        Type.Object({
          submitText: Type.String({
            description:
              "作为真正 user message 发送并完整显示给玩家的自然玩家输入；不得压缩、不得写机械编号文本",
          }),
        }),
        {
          minItems: 1,
          maxItems: 4,
          description:
            "可选：玩家下一步候选行动。只给 UI 使用，不进入正文；候选显示 submitText 全文，禁止压缩",
        },
      ),
    ),
    canonFacts: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "渲染所需原作事实预填；渲染器没有 lookup，缺位它就会编（叙事轮必填，可为空数组）",
      }),
    ),
    constraints: Type.Optional(
      Type.Object({
        forbiddenContent: Type.Array(Type.String(), {
          description:
            "渲染器不得写入或暗示的原文/意象列表。用于标注本轮应回避的话题、尚未揭示的伏笔，或玩家不希望在正文里看到的特定内容。非 binding",
        }),
      }),
    ),
    directReply: Type.Optional(
      Type.String({ description: "直答轮的回复内容（needsRender=false 时必填）" }),
    ),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    submitDirectionPacketTool(params, ctx.sessionManager),
};
