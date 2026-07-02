import type { DirectionPacket } from "./packet-schema.ts";

import { findSecretLeaks } from "../audit/lint-rules.ts";

/**
 * Packet secret 防火墙（backlog #12）：direction packet 是渲染器唯一的信息通道，
 * 任何未揭示秘密字符串（真名/隐藏宝具名）出现在 packet 任意字段中都必须在
 * 进入渲染器之前被拦截——包括 refusesToSay（它只允许描述「拒说什么」，
 * 不允许携带秘密本体）。
 *
 * 未揭示秘密清单由调用方从当前 state.secrets 提取
 * （engine/audit/lint-rules.ts 的 collectUnrevealedSecretStrings）。
 */

export interface FirewallFinding {
  /** 命中的 packet 字段路径，如 npcStances[0].refusesToSay */
  path: string;
  /** 泄漏的秘密字符串 */
  secret: string;
  excerpt: string;
}

export type FirewallVerdict = { kind: "pass" } | { kind: "blocked"; findings: FirewallFinding[] };

function* packetStrings(packet: DirectionPacket): Generator<[path: string, text: string]> {
  if (!packet.needsRender) {
    yield ["directReply", packet.directReply];
    return;
  }
  yield ["playerAction", packet.playerAction];
  yield ["endWindow", packet.endWindow];
  for (const [i, text] of packet.resolvedChanges.entries()) {
    yield [`resolvedChanges[${i}]`, text];
  }
  for (const [i, text] of packet.sensoryAnchors?.entries() ?? []) {
    yield [`sensoryAnchors[${i}]`, text];
  }
  for (const [i, text] of packet.canonFacts?.entries() ?? []) {
    yield [`canonFacts[${i}]`, text];
  }
  for (const [i, action] of packet.suggestedActions?.entries() ?? []) {
    yield [`suggestedActions[${i}].submitText`, action.submitText];
  }
  for (const [i, stance] of packet.npcStances?.entries() ?? []) {
    yield [`npcStances[${i}].stance`, stance.stance];
    yield [`npcStances[${i}].wants`, stance.wants];
    yield [`npcStances[${i}].move`, stance.move];
    yield [`npcStances[${i}].refusesToSay`, stance.refusesToSay];
  }
  for (const [i, omission] of packet.npcOmissions?.entries() ?? []) {
    yield [`npcOmissions[${i}].playerSafeNote`, omission.playerSafeNote];
  }
}

export function scanDirectionPacket(
  packet: DirectionPacket,
  unrevealedSecrets: readonly string[],
): FirewallVerdict {
  const findings: FirewallFinding[] = [];
  for (const [path, text] of packetStrings(packet)) {
    for (const leak of findSecretLeaks(text, unrevealedSecrets)) {
      findings.push({ path, secret: leak.match, excerpt: leak.excerpt });
    }
  }
  return findings.length === 0 ? { kind: "pass" } : { kind: "blocked", findings };
}
