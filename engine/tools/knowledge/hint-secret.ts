import type { State } from "../../core/state/state.ts";
import type { DomainToolDefinition } from "../runtime/tool-definition.ts";
import type { ToolResult } from "../runtime/tool-result.ts";

import { Type } from "typebox";

import { openHook, surfaceHook } from "../../core/ledger/hooks.ts";
import { assertNonEmptyString, isRecord } from "../../core/utils/typebox-validation.ts";
import { runDomainEventTool } from "../system/domain-tool-runner.ts";

export function hintSecretTool(params: unknown, sessionManager: unknown): ToolResult {
  return runDomainEventTool({
    sessionManager,
    execute: (draft) => {
      const raw = isRecord(params) ? params : {};
      const secretId = assertNonEmptyString(raw["secretId"], "secretId");
      const hintText = assertNonEmptyString(raw["hintText"], "hintText");
      const reason = assertNonEmptyString(raw["reason"], "reason");
      const secretText = typeof raw["secretText"] === "string" ? raw["secretText"] : undefined;

      let hookId: string;
      const found = findSecretSlot(draft, secretId);
      if (found === null) {
        if (secretText !== undefined && secretText.length > 0) {
          draft.secrets.hiddenWorldFacts.push({
            id: secretId,
            text: secretText,
            revealState: "foreshadowed",
            revealCondition: `已暗示（${reason}）`,
            relatedActorIds: [draft.public.protagonistActorId],
          });
        } else {
          const available = collectAllSecretIds(draft);
          throw new Error(
            `hint_secret: 未找到 secret ${secretId}。可用 secrets: ${available.length > 0 ? available.join(", ") : "无"}。如需自动创建，请传 secretText。`,
          );
        }
      } else {
        if (found.revealState === "revealed") {
          throw new Error(
            `hint_secret: secret ${secretId} 已完全揭示。无法对已揭示的秘密给出暗示。`,
          );
        }
        found.revealState = "foreshadowed";
      }

      // dedup：如果已存在关联同一秘密的 hook，复用并复现
      const existing = draft.public.hooks.find(
        (h) => h.relatedSecretId === secretId && h.status !== "paid" && h.status !== "retired",
      );
      if (existing !== undefined) {
        if (existing.status === "active") {
          existing.lastNovelty = hintText;
          existing.lastSurfacedAt = draft.public.clock.currentAt;
          existing.surfaceCount++;
        } else {
          surfaceHook(draft, existing.id, hintText);
        }
        hookId = existing.id;
      } else {
        const hook = openHook(draft, hintText, secretId);
        hookId = hook.id;
      }

      return { secretId, hookId, hintText };
    },
    details: (result) => ({ ...result }),
    message: (result) =>
      `秘密已暗示：${result.secretId}。${result.hookId ? `hook ${result.hookId}` : ""}「${result.hintText}」。`,
  });
}

const HINT_SECRET_PARAMETER_SCHEMA = Type.Object({
  secretId: Type.String({
    minLength: 1,
    description: "目标 secret id。如果不存在，传 secretText 会自动创建",
  }),
  hintText: Type.String({
    description: "暗示文本——玩家能感知到的线索、预感或异常现象",
  }),
  secretText: Type.Optional(
    Type.String({
      description: "可选。secretId 不存在时自动创建 HiddenWorldFact。secretId 已存在时忽略此字段",
    }),
  ),
  reason: Type.String({ description: "为什么现在给出这个暗示" }),
});

export const hintSecretToolDefinition: DomainToolDefinition = {
  name: "hint_secret",
  description:
    "对隐藏秘密给出浅层暗示，标记秘密为 foreshadowed，并创建一个 hook（叙事张力条目）。\n\n" +
    "与 reveal_secret 的区别：reveal_secret 需要完整的证据链裁决（claims + matching + jury），hint_secret 不碰任何裁决——" +
    "它只做两件事：(1) 把秘密的 revealState 设为 foreshadowed 或自动创建新秘密后 foreshadow；(2) 创建一个 hook。\n\n" +
    "【秘密不存在时】\n" +
    "如果 secretId 尚不存在，传 secretText 会自动创建一个 HiddenWorldFact。这样不需要先调 configure_secret 再调 hint_secret。\n" +
    "如果 secretId 已存在，secretText 被忽略。\n\n" +
    "【什么时候用】\n" +
    '- 玩家角色感知到异常但无法确认时（"教堂地下室传来低语"）\n' +
    "- NPC 给出了隐晦信息但未和盘托出时\n" +
    "- 环境暗示某件隐藏真相的存在时\n\n" +
    "【hook 生命周期】\n" +
    "hint_secret 创建的 hook 占 active budget（最多 2 个）。后续可通过 update_hook surface/park/escalate/pay/retire 管理。\n" +
    "当秘密通过 reveal_secret 正式揭示时，关联的 hook 应 retire 收口。\n\n" +
    "【不要这样做】\n" +
    "- 替代 reveal_secret——foreshadow 后仍需要用 reveal_secret 正式揭示\n" +
    "- 对已揭示的秘密 hint（会报错）\n" +
    "- 给明显公开的信息 hint",
  parameters: HINT_SECRET_PARAMETER_SCHEMA,
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    hintSecretTool(params, ctx.sessionManager),
};

export function findSecretSlot(draft: State, secretId: string): { revealState: string } | null {
  for (const bundle of Object.values(draft.secrets.actorStates)) {
    const slots = bundle.secrets;
    if (!slots) continue;
    for (const slot of slots.beyonderSecrets) {
      if (slot.id === secretId) return slot;
    }
    for (const slot of slots.privateMotives) {
      if (slot.id === secretId) return slot;
    }
    for (const slot of slots.unrevealedAffiliations) {
      if (slot.id === secretId) return slot;
    }
  }
  for (const fact of draft.secrets.hiddenWorldFacts) {
    if (fact.id === secretId) return fact;
  }
  return null;
}

export function collectAllSecretIds(draft: State): string[] {
  const ids: string[] = [];
  for (const bundle of Object.values(draft.secrets.actorStates)) {
    const slots = bundle.secrets;
    if (!slots) continue;
    for (const slot of slots.beyonderSecrets) ids.push(slot.id);
    for (const slot of slots.privateMotives) ids.push(slot.id);
    for (const slot of slots.unrevealedAffiliations) ids.push(slot.id);
  }
  for (const fact of draft.secrets.hiddenWorldFacts) ids.push(fact.id);
  return ids;
}
