import type { DomainToolDefinition } from "../runtime/tool-definition.ts";
import type { ToolResult } from "../runtime/tool-result.ts";

import { Type } from "typebox";

import type { State } from "../../core/state/state.ts";

import { openHook } from "../../core/ledger/hooks.ts";
import { assertNonEmptyString, isRecord } from "../../core/utils/typebox-validation.ts";
import { runDomainEventTool } from "../system/domain-tool-runner.ts";

export function hintSecretTool(params: unknown, sessionManager: unknown): ToolResult {
  return runDomainEventTool({
    sessionManager,
    execute: (draft) => {
      const raw = isRecord(params) ? params : {};
      const secretId = assertNonEmptyString(raw["secretId"], "secretId");
      const hintText = assertNonEmptyString(raw["hintText"], "hintText");
      assertNonEmptyString(raw["reason"], "reason");

      const found = findSecretSlot(draft, secretId);
      if (found === null) {
        const available = collectAllSecretIds(draft);
        throw new Error(
          `hint_secret: 未找到 secret ${secretId}。请先用 configure_secret 创建秘密。可用 secrets: ${available.length > 0 ? available.join(", ") : "无"}`,
        );
      }
      if (found.revealState === "revealed") {
        throw new Error(
          `hint_secret: secret ${secretId} 已完全揭示。无法对已揭示的秘密给出暗示。`,
        );
      }
      found.revealState = "foreshadowed";

      const hook = openHook(draft, hintText);
      return { secretId, hookId: hook.id, hintText };
    },
    details: (result) => ({ ...result }),
    message: (result) =>
      `秘密已暗示：${result.secretId}。已创建暗示钩子 ${result.hookId}：「${result.hintText}」。`,
  });
}

const HINT_SECRET_PARAMETER_SCHEMA = Type.Object({
  secretId: Type.String({
    minLength: 1,
    description: "目标 secret id；必须先用 configure_secret 创建",
  }),
  hintText: Type.String({
    description: "暗示文本——玩家能感知到的线索、预感或异常现象",
  }),
  reason: Type.String({ description: "为什么现在给出这个暗示" }),
});

export const hintSecretToolDefinition: DomainToolDefinition = {
  name: "hint_secret",
  description:
    "对隐藏秘密给出浅层暗示，标记秘密为 foreshadowed（揭示进度），并创建一个 hook（叙事张力条目）。\n\n" +
    "与 reveal_secret 的区别：reveal_secret 需要完整的证据链裁决（claims + matching + jury），hint_secret 不碰任何裁决——" +
    "它只做两件事：(1) 把秘密的 revealState 设为 foreshadowed；(2) 创建一个 hook（玩家可见的张力信号）。\n\n" +
    "【什么时候用】\n" +
    '- 玩家角色感知到异常但无法确认时（"教堂地下室传来低语"）\n' +
    '- NPC 给出了隐晦信息但未和盘托出时\n' +
    '- 环境暗示某件隐藏真相的存在时\n\n' +
    "【hook 生命周期】\n" +
    "hint_secret 创建的 hook 占 active budget（最多 2 个）。后续可通过 update_hook surface/park/escalate/pay/retire 管理。\n" +
    "当秘密通过 reveal_secret 正式揭示时，关联的 hook 应 retire 收口。\n\n" +
    "【不要这样做】\n" +
    "- 替代 reveal_secret——foreshadow 后仍需要用 reveal_secret 正式揭示\n" +
    "- 对已揭示的秘密 hint（会报错）\n" +
    "- 给明显公开的信息 hint（那不属于秘密）",
  parameters: HINT_SECRET_PARAMETER_SCHEMA,
  execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
    hintSecretTool(params, ctx.sessionManager),
};

function findSecretSlot(
  draft: State,
  secretId: string,
): { revealState: string } | null {
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

function collectAllSecretIds(draft: State): string[] {
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
