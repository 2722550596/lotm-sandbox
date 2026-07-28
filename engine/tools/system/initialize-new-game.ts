import type { DomainToolDefinition } from "../runtime/tool-definition.ts";
import type { ToolResult } from "../runtime/tool-result.ts";

import { Type } from "typebox";

import {
  initializeNewGame,
  parseNewGameInitializationInput,
} from "../../core/init/initialize-new-game.ts";
import { SITUATION_KIND_SCHEMA } from "../../core/state/state-enum-schemas.ts";
import { LOCATION_STATE_SCHEMA } from "../../core/turn/turn-time-schema.ts";
import { resultDetails, runDomainEventTool } from "./domain-tool-runner.ts";

function buildInitializationMessage(result: Awaited<ReturnType<typeof initializeNewGame>>): string {
  const lines: string[] = [
    `新游戏 state 已初始化。protagonist actor ID: ${result.protagonistActorId}。`,
  ];
  if (result.premise !== undefined) {
    lines.push(`预设前提：${result.premise}`);
  }
  if (result.openingHooks !== undefined) {
    for (const [key, hook] of Object.entries(result.openingHooks)) {
      if (hook !== undefined) {
        lines.push(`[${key}] ${hook}`);
      }
    }
  }
  lines.push("注意：初始化仅意味着初始框架已配置，后续领域事件仍需手动配置，不能跳过。");
  return lines.join("\n");
}

export function initializeNewGameTool(params: unknown, sessionManager: unknown): ToolResult {
  return runDomainEventTool({
    sessionManager,
    execute: (draft) =>
      initializeNewGame(draft, parseNewGameInitializationInput(params, "initialize_new_game 参数")),
    details: resultDetails,
    message: buildInitializationMessage,
  });
}

export const initializeNewGameToolDefinition: DomainToolDefinition = {
  name: "initialize_new_game",
  description:
    "初始化新游戏 Game State 的单入口 recipe：重置 state、配置 scenario（可覆盖 preset 的地点/态势）、写 protagonist、设在场 actor、必要时配 protagonist 序列隐藏秘密。\n\n" +
    "【使用边界】\n" +
    "- /skill:start-game 已定好时间线/立场/开场身份，进正式剧情前一次性建立可运行 state\n" +
    "- protagonist 是非凡者且序列秘密需 hidden-canonical secret slot\n\n" +
    "禁区：\n" +
    "- 用它续局、修档或剧情中重置后果\n" +
    "- 把 player-only 原作知识写成 public world fact\n" +
    "- protagonist 非凡者开局直接 public revealed 序列（未公开必须 hidden/suspected + pathSequenceSecret secret）\n" +
    "- 用它替代后续领域事件工具",
  parameters: Type.Object({
    kind: Type.String({ description: "human-protagonist / beyonder-protagonist" }),
    actorId: Type.Optional(
      Type.String({ description: "protagonist actor ID（留空自动为 protagonist）" }),
    ),
    scenario: Type.Object({
      presetId: Type.String({
        description:
          "tingen_1349_klein / tingen_1349_default / backlund_1350 / bayam_1351 / condat_1349 / custom_worldline",
      }),
      title: Type.Optional(Type.String()),
      premise: Type.Optional(Type.String()),
      startedAt: Type.Optional(Type.String({ description: "UTC ISO instant" })),
      currentAt: Type.Optional(Type.String({ description: "UTC ISO instant" })),
      reason: Type.Optional(Type.String()),
      location: Type.Optional(LOCATION_STATE_SCHEMA),
      situation: Type.Optional(SITUATION_KIND_SCHEMA),
    }),
    protagonist: Type.Unknown({
      description:
        "human: canonicalName/renderName/publicIdentity/background/apparentAge/outfit/demeanor/roles/abilities/ordinaryItems；beyonder additionally pathway/sequence/rank/promotionSystem。renderName 是正文固定用名，中文名优先。abilities 每项为 {label, summary} 对象，id 自动生成。",
    }),
    presence: Type.Optional(
      Type.Object({
        presentActorIds: Type.Array(Type.String()),
        allyActorIds: Type.Optional(Type.Array(Type.String())),
      }),
    ),
    knownFacts: Type.Optional(
      Type.Array(
        Type.Object({
          scope: Type.String({
            description: "protagonist / npc / faction / world",
          }),
          subject: Type.Optional(Type.String()),
          text: Type.String(),
        }),
      ),
    ),
    reason: Type.String(),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    initializeNewGameTool(params, ctx.sessionManager),
};
