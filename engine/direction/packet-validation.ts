import type { ActorId, State } from "../core/state/state.ts";
import type { RenderDirectionPacket } from "./packet-schema.ts";

/**
 * Direction Packet 语义校验（shape/secret 之外的第三道）：
 * 渲染器只能演出当前场景里真实存在的人。本模块保证：
 * - npcStances / npcOmissions 的 actorId 都存在且在场；
 * - 同一 actor 不会同时出现在 stance 和 omission；
 * - 重要在场 NPC 要么有主动 beat（stance），要么被明确静置（omission）。
 *
 * “重要在场 NPC” 是可计算集合：在场且非主角，且满足以下任一——
 * 有印象卡 / 出现在关系信号 / 是盟友 / 有 secret agenda。
 */
export interface PacketValidationContext {
  /** 当前场景在场 actor id */
  presentActorIds: ReadonlySet<ActorId>;
  /** public.actors 里已存在的 actor id */
  knownActorIds: ReadonlySet<ActorId>;
  /** 必须被 stance 或 omission 覆盖的重要在场 NPC */
  importantPresentActorIds: ReadonlySet<ActorId>;
}

export function buildPacketValidationContext(state: State): PacketValidationContext {
  const pub = state.public;
  const knownActorIds = new Set<ActorId>(Object.keys(pub.actors));
  const presentActorIds = new Set<ActorId>(pub.scene.presentActorIds);
  const allies = new Set<ActorId>(pub.allyActorIds);

  const relationshipActorIds = new Set<ActorId>();
  for (const signal of pub.relationshipSignals) {
    relationshipActorIds.add(signal.actorId);
    relationshipActorIds.add(signal.targetActorId);
  }
  for (const signal of state.secrets.relationshipSignals) {
    relationshipActorIds.add(signal.actorId);
    relationshipActorIds.add(signal.targetActorId);
  }

  const agendaActorIds = new Set<ActorId>();
  for (const [actorId, bundle] of Object.entries(state.secrets.actorStates)) {
    if (bundle.agenda !== undefined) {
      agendaActorIds.add(actorId);
    }
  }

  const importantPresentActorIds = new Set<ActorId>();
  for (const actorId of presentActorIds) {
    if (actorId === pub.protagonistActorId) {
      continue;
    }
    const isImportant =
      pub.actorImpressions[actorId] !== undefined ||
      relationshipActorIds.has(actorId) ||
      allies.has(actorId) ||
      agendaActorIds.has(actorId);
    if (isImportant) {
      importantPresentActorIds.add(actorId);
    }
  }

  return { presentActorIds, knownActorIds, importantPresentActorIds };
}

export function validateRenderDirectionPacket(
  packet: RenderDirectionPacket,
  ctx: PacketValidationContext,
): void {
  const errors: string[] = [];
  const stanceActorIds = new Set<ActorId>();
  (packet.npcStances ?? []).forEach((stance, index) => {
    assertExistingPresentActor(stance.actorId, `npcStances[${index}].actorId`, ctx, errors);
    if (stanceActorIds.has(stance.actorId)) {
      errors.push(`npcStances 重复 actorId：${stance.actorId}。`);
    }
    stanceActorIds.add(stance.actorId);
  });

  const omissionActorIds = new Set<ActorId>();
  for (const [index, omission] of (packet.npcOmissions ?? []).entries()) {
    assertExistingPresentActor(omission.actorId, `npcOmissions[${index}].actorId`, ctx, errors);
    if (omissionActorIds.has(omission.actorId)) {
      errors.push(`npcOmissions 重复 actorId：${omission.actorId}。`);
    }
    omissionActorIds.add(omission.actorId);
  }

  for (const actorId of stanceActorIds) {
    if (omissionActorIds.has(actorId)) {
      errors.push(`actor 同时出现在 npcStances 和 npcOmissions：${actorId}。二选一。`);
    }
  }

  const covered = new Set<ActorId>([...stanceActorIds, ...omissionActorIds]);
  const uncovered = [...ctx.importantPresentActorIds].filter((actorId) => !covered.has(actorId));
  if (uncovered.length > 0) {
    errors.push(
      [
        `重要在场 NPC 未被覆盖：${uncovered.join("、")}。`,
        "每个重要在场 NPC 必须出现在 npcStances（有主动 beat）或 npcOmissions（被明确静置，附 reasonCode + playerSafeNote），",
        "否则渲染器会把他们脑补成被动布景，破坏物理连续性。",
      ].join("\n"),
    );
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "direction packet 语义校验未通过：",
        ...errors.map((error) => `- ${error}`),
        `当前在场 actor：${formatActorList(ctx.presentActorIds)}。`,
      ].join("\n"),
    );
  }
}

function assertExistingPresentActor(
  actorId: ActorId,
  path: string,
  ctx: PacketValidationContext,
  errors: string[],
): void {
  if (!ctx.knownActorIds.has(actorId)) {
    errors.push(`${path} 指向不存在的 actor：${actorId}。`);
    return;
  }
  if (!ctx.presentActorIds.has(actorId)) {
    errors.push(
      `${path} 指向不在场的 actor：${actorId}。远程/投影/通讯请先用 set_scene_presence 建模在场，再写 stance。`,
    );
  }
}

function formatActorList(actorIds: ReadonlySet<ActorId>): string {
  return actorIds.size === 0 ? "（无）" : [...actorIds].join("、");
}
