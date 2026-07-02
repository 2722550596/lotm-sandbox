import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { DomainToolDefinition } from "./runtime/tool-definition.ts";

import { resolveLOTMCombatExchangeToolDefinition } from "../core/combat/combat-exchange-lotm.ts";
import { recordActingFeedbackToolDefinition } from "./actor/record-acting-feedback.ts";
import { recordActorKnowledgeToolDefinition } from "./actor/record-actor-knowledge.ts";
import { retireActorToolDefinition } from "./actor/retire-actor.ts";
import { setScenePresenceToolDefinition } from "./actor/set-scene-presence.ts";
import { updateActorAgendaToolDefinition } from "./actor/update-actor-agenda.ts";
import { updateActorConditionToolDefinition } from "./actor/update-actor-condition.ts";
import { updateActorImpressionToolDefinition } from "./actor/update-actor-impression.ts";
import { updateActorOutfitToolDefinition } from "./actor/update-actor-outfit.ts";
import { upsertActorToolDefinition } from "./actor/upsert-actor.ts";
import { manageUndercurrentToolDefinition } from "./backstage/manage-undercurrent.ts";
import { adjustClockToolDefinition } from "./debug/adjust-clock.ts";
import { clearBackstageLockToolDefinition } from "./debug/clear-backstage-lock.ts";
import { clearObligationToolDefinition } from "./debug/clear-obligation.ts";
import { debugSignalToolDefinition } from "./debug/debug-signal.ts";
import { getStateSchemaToolDefinition } from "./debug/get-state-schema.ts";
import { overrideLockedFactToolDefinition } from "./debug/override-locked-fact.ts";
import { patchStateToolDefinition } from "./debug/patch-state.ts";
import { resetStateToolDefinition } from "./debug/reset-state.ts";
import { updateEconomyToolDefinition } from "./economy/update-economy.ts";
import { updateTrackedItemToolDefinition } from "./inventory/update-tracked-item.ts";
import { configureSecretToolDefinition } from "./knowledge/configure-secret.ts";
import { hintSecretToolDefinition } from "./knowledge/hint-secret.ts";
import { recallMemoryToolDefinition } from "./knowledge/recall-memory.ts";
import { recordMemoryToolDefinition } from "./knowledge/record-memory.ts";
import { revealSecretToolDefinition } from "./knowledge/reveal-secret.ts";
import { summarizeSecretsToolDefinition } from "./knowledge/summarize-secrets.ts";
import { lookupAbilityToolDefinition } from "./lookup/ability-lookup-tool.ts";
import { lookupEconomyToolDefinition } from "./lookup/economy-lookup.ts";
import { lookupToolDefinition } from "./lookup/lookup-rag.ts";
import { lookupNovelToolDefinition } from "./lookup/novel-lookup.ts";
import { lookupSequenceToolDefinition } from "./lookup/sequence-lookup-tool.ts";
import { attemptPromotionToolDefinition } from "./lotm/attempt-promotion.ts";
import { recordRelationshipSignalToolDefinition } from "./relationship/record-relationship-signal.ts";
import { renderDomainToolResult } from "./runtime/tool-render.ts";
import { commitTurnToolDefinition } from "./scene/commit-turn.ts";
import { privateResolveToolDefinition } from "./scene/private-resolve.ts";
import { submitDirectionPacketToolDefinition } from "./scene/submit-direction-packet.ts";
import { getStatusRawToolDefinition, getStatusToolDefinition } from "./system/get-status.ts";
import { initializeNewGameToolDefinition } from "./system/initialize-new-game.ts";
import { updateHookToolDefinition } from "./system/update-hook.ts";

/** 全部 Domain Event Tool 契约清单；契约本体与实现同文件维护。 */
const TOOL_DEFINITIONS: readonly DomainToolDefinition[] = [
  initializeNewGameToolDefinition,
  commitTurnToolDefinition,
  getStatusToolDefinition,
  getStatusRawToolDefinition,
  recordMemoryToolDefinition,
  manageUndercurrentToolDefinition,
  retireActorToolDefinition,
  updateActorAgendaToolDefinition,
  recordActorKnowledgeToolDefinition,
  recordRelationshipSignalToolDefinition,
  recallMemoryToolDefinition,
  updateActorImpressionToolDefinition,
  updateActorConditionToolDefinition,
  updateTrackedItemToolDefinition,
  updateActorOutfitToolDefinition,
  configureSecretToolDefinition,
  setScenePresenceToolDefinition,
  upsertActorToolDefinition,
  hintSecretToolDefinition,
  recordActingFeedbackToolDefinition,
  updateEconomyToolDefinition,
  revealSecretToolDefinition,
  summarizeSecretsToolDefinition,
  privateResolveToolDefinition,
  submitDirectionPacketToolDefinition,
  updateHookToolDefinition,
  lookupToolDefinition,
  lookupEconomyToolDefinition,
  lookupNovelToolDefinition,
  patchStateToolDefinition,
  adjustClockToolDefinition,
  overrideLockedFactToolDefinition,
  clearBackstageLockToolDefinition,
  clearObligationToolDefinition,
  debugSignalToolDefinition,
  lookupAbilityToolDefinition,
  lookupSequenceToolDefinition,
  resetStateToolDefinition,
  getStateSchemaToolDefinition,
  attemptPromotionToolDefinition,
  resolveLOTMCombatExchangeToolDefinition,
];

export function registerAllTools(pi: ExtensionAPI): void {
  for (const definition of TOOL_DEFINITIONS) {
    pi.registerTool({ label: "LOTM 叙事", renderResult: renderDomainToolResult, ...definition });
  }
}
