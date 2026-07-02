import type { PublicGameState, SecretGameState } from "./state.ts";

import { formatHookLedger } from "../ledger/hooks.ts";
import { OBLIGATION_KIND_GUIDANCE } from "../ledger/obligations.ts";
import { recentPlayerKnownRelationshipSignals } from "../actor/relationship-signal.ts";
import { diffMinutes, formatHumanTime } from "./date-time.ts";
import { formatAmount } from "../economy/economy-denomination.ts";

export function buildGmBrief(
  publicState: PublicGameState,
  secrets?: SecretGameState,
): string {
  const protagonist = publicState.actors[publicState.protagonistActorId];
  if (protagonist === undefined) {
    throw new Error(`GM brief failed: protagonist ${publicState.protagonistActorId} missing.`);
  }
  const time = formatHumanTime(publicState.clock.currentAt, publicState.clock.timezone);
  return [
    "[当前 GM 简报]",
    `时间：${time.display}`,
    `地点：${formatPublicLocation(publicState.scene.location, { includeBoundary: true })}`,
    `态势：${publicState.scene.situation}`,
    `剧情窗口：${formatStoryWindow(publicState)}`,
    `玩家角色：${formatActorLine(protagonist)}`,
    ...formatProtagonistExtra(protagonist),
    `同行者：${formatAllies(publicState)}`,
    `资源：${formatGmBriefFunds(publicState)}`,
    ...formatTrackedItemsBrief(publicState),
    ...formatDebts(publicState),
    `状态效果：${formatCondition(protagonist.condition)}`,
    `当前目标：${formatActiveObjectives(publicState, { separator: "；" })}`,
    `目标推进规则：${formatObjectiveRouting(publicState)}`,
    `当前威胁：${formatSceneThreats(publicState, { separator: "；", colon: ":" })}`,
    `威胁清除规则：${formatThreatRouting(publicState)}`,
    ...formatOpenObligationLines(publicState),
    ...formatHookLedgerLines(publicState),
    `最近关系信号：${formatRecentRelationshipSignals(publicState)}`,
    `最近重大记忆：${formatRecentEvents(publicState)}`,
    ...formatPinnedFacts(publicState),
    ...formatScheduledEvents(publicState, secrets),
    ...formatSecretsGlance(publicState, secrets),
    ...formatTurnLog(publicState),
    "本轮工具纪律：每轮 time 必须用 elapsed/travel 推进时间；Scene Beat lifecycle 用 begin-beat/complete-beat scene 子事件；actor 入场/离场用 set_scene_presence。不要输出 JSON、数值表、schema 字段。",
  ].join("\n");
}

function formatHookLedgerLines(publicState: PublicGameState): string[] {
  const ledger = formatHookLedger(publicState.hooks);
  return ledger === undefined ? [] : [ledger];
}

function formatOpenObligationLines(publicState: PublicGameState): string[] {
  if (publicState.obligations.length === 0) return [];
  const lines: string[] = ["⚠ 未清裁决义务（canonical commit 前必须落地）："];
  for (const entry of publicState.obligations) {
    lines.push(
      `  ${entry.id}: [${entry.kind}] ${entry.summary} → 💡 ${OBLIGATION_KIND_GUIDANCE[entry.kind]}`,
    );
  }
  return lines;
}

export function buildStatusMarkdown(publicState: PublicGameState): string {
  return [
    "## 当前状态",
    "",
    `- 时间：${publicState.clock.currentAt}（${publicState.clock.timezone}）`,
    `- 地点：${formatPublicLocation(publicState.scene.location)}`,
    `- 场景：${publicState.scene.situation}`,
    `- 在场：${formatPresentActors(publicState)}`,
    `- 目标：${formatActiveObjectives(publicState, { separator: "；" })}`,
    `- 威胁：${formatSceneThreats(publicState, { separator: "；", colon: ": " })}`,
    "",
    buildInventoryMarkdown(publicState),
  ].join("\n");
}

export function buildInventoryMarkdown(publicState: PublicGameState): string {
  return [
    "## 资源与物品",
    "",
    "### 资金",
    "",
    formatFunds(publicState),
    "",
    "### 关键物品",
    "",
    formatTrackedItems(publicState),
    "",
    "### 普通随身物",
    "",
    formatOrdinaryItems(publicState),
  ].join("\n");
}

function formatPublicLocation(
  location: PublicGameState["scene"]["location"],
  options: { includeBoundary?: boolean } = {},
): string {
  const base = [location.region, location.site, location.detail]
    .filter((part) => part.length > 0)
    .join(" · ");
  if (!options.includeBoundary || location.boundary === "normal") {
    return base;
  }
  return `${base}（${location.boundary}）`;
}

function formatActiveObjectives(
  publicState: PublicGameState,
  options: { separator: string },
): string {
  const active = publicState.scene.objectives.filter(
    (objective) => objective.status !== "resolved",
  );
  return active.length === 0
    ? "无"
    : active.map((objective) => `${objective.id}: ${objective.summary}`).join(options.separator);
}

function formatObjectiveRouting(publicState: PublicGameState): string {
  const activeObjectives = publicState.scene.objectives.filter(
    (objective) => objective.status !== "resolved",
  );
  if (publicState.scene.storyWindow === null) {
    return "当前没有 active Scene Beat；objectives 是 beat-scoped 状态，不能用 commit_turn 增删。复杂新场景先用 begin-beat scene 事件；普通状态变化用 commit_turn。";
  }
  if (activeObjectives.length === 0) {
    return "当前 beat 的目标已全部解决；用 complete-beat scene 事件收口。";
  }
  return "active beat 收口用 complete-beat scene 事件；仅在局部解决非最终目标时，commit_turn 的 scene event 用 resolve-objective 并用 objectiveSummary 逐字复制上方 summary（不能解决最后一个目标）。";
}

function formatSceneThreats(
  publicState: PublicGameState,
  options: { separator: string; colon: string },
): string {
  return publicState.scene.threats.length === 0
    ? "无"
    : publicState.scene.threats
        .map((threat) => `${threat.id} [${threat.severity}]${options.colon}${threat.summary}`)
        .join(options.separator);
}

function formatThreatRouting(publicState: PublicGameState): string {
  if (publicState.scene.threats.length === 0) {
    return "当前没有可清除的威胁；不要使用 clear-threat。";
  }
  return "用 commit_turn 局部清除威胁时，scene event 用 clear-threat，并用 threatSummary 逐字复制上方威胁的 summary（或用上方方括号前的 threatId）。";
}

function formatStoryWindow(publicState: PublicGameState): string {
  const window = publicState.scene.storyWindow;
  if (window === null) {
    return "未设定；复杂场景应先用 begin-beat scene 事件锁定 beat 边界";
  }
  const allowed = window.allowedActions.length === 0 ? "未列出" : window.allowedActions.join("、");
  const forbidden =
    window.forbiddenEscalations.length === 0 ? "未列出" : window.forbiddenEscalations.join("、");
  const criteria =
    window.completionCriteria.length === 0 ? "未列出" : window.completionCriteria.join("、");
  return `${window.currentArcId}/${window.currentBeatId}《${window.title}》；允许：${allowed}；禁区：${forbidden}；完成：${criteria}`;
}

function formatActorLine(actor: NonNullable<PublicGameState["actors"][string]>): string {
  const identity = formatIdentity(actor);
  const sequence = formatSequence(actor);
  const name =
    actor.presentation.canonicalName !== actor.presentation.renderName &&
    actor.presentation.canonicalName.length > 0
      ? `${actor.presentation.renderName}（真名：${actor.presentation.canonicalName}）`
      : actor.presentation.renderName;
  return [name, actor.kind, identity, sequence].join(" / ");
}

function formatIdentity(actor: NonNullable<PublicGameState["actors"][string]>): string {
  const memoryIdentity = actor.identity.lockedFacts.find((fact) => fact.id === "setup-identity");
  return memoryIdentity?.text ?? actor.identity.publicIdentity;
}

function formatSequence(actor: NonNullable<PublicGameState["actors"][string]>): string {
  const seq = actor.sequence;
  if (seq === null) {
    return "无序列";
  }
  const parts: string[] = [
    seq.currentSequence,
    `途径${seq.pathway}`,
  ];
  if (seq.actingCues.length > 0) {
    parts.push(`扮演${seq.actingCues.length}条`);
  }
  return parts.join("；");
}
function formatProtagonistExtra(
  actor: NonNullable<PublicGameState["actors"][string]>
): string[] {
  const lines: string[] = [];
  const parts: string[] = [];
  if (actor.presentation.apparentAge.length > 0) {
    parts.push(`年龄：${actor.presentation.apparentAge}`);
  }
  if (actor.presentation.demeanor.length > 0) {
    parts.push(`风范：${actor.presentation.demeanor}`);
  }
  if (parts.length > 0) {
    lines.push(`  基础：${parts.join(" · ")}`);
  }
  if (
    actor.presentation.outfit.label.length > 0 ||
    actor.presentation.outfit.details.length > 0
  ) {
    const outfitParts: string[] = [];
    if (actor.presentation.outfit.details.length > 0) {
      outfitParts.push(actor.presentation.outfit.details);
    }
    if (actor.presentation.outfit.label.length > 0) {
      outfitParts.push(`（${actor.presentation.outfit.label}）`);
    }
    lines.push(`  外貌：${outfitParts.join(" ")}`);
  }
  if (actor.identity.roles.length > 0) {
    lines.push(`  社会角色：${actor.identity.roles.join("、")}`);
  }
  if (actor.inventory.items.length > 0) {
    lines.push(`  随身物品：${actor.inventory.items.join("、")}`);
  }
  if (actor.abilities.length > 0) {
    lines.push(
      `  能力：${actor.abilities.map((a) => `${a.label}：${a.summary}`).join(";")}`
    );
  }
  if (actor.identity.background.length > 0) {
    lines.push(`  背景：${actor.identity.background}`);
  }
  const extraFacts = actor.identity.lockedFacts.filter(
    (fact) => fact.id !== "setup-identity"
  );
  if (extraFacts.length > 0) {
    lines.push(
      `  记录：${extraFacts.map((fact) => fact.text).join("；")}`
    );
  }
  const seq = actor.sequence;
  if (seq !== null) {
    const seqParts: string[] = [];
    if (typeof seq.rank === "string" && seq.rank.length > 0) {
      seqParts.push(`等级：${seq.rank}`);
    }
    if (typeof seq.promotionSystem === "string" && seq.promotionSystem.length > 0) {
      seqParts.push(`晋升：${seq.promotionSystem}`);
    }
    if (seq.tags.length > 0) {
      seqParts.push(`标签：${seq.tags.map((t) => t.name).join("、")}`);
    }
    if (seqParts.length > 0) {
      lines.push(`  序列详情：${seqParts.join(" · ")}`);
    }
  }
  return lines;
}

function formatAllies(publicState: PublicGameState): string {
  if (publicState.allyActorIds.length === 0) {
    return "无";
  }
  return publicState.allyActorIds
    .map((actorId) => publicState.actors[actorId])
    .filter((actor) => actor !== undefined)
    .map((actor) => {
      const base = `${actor.presentation.renderName}（${actor.relationshipToProtagonist.summary}）`;
      const extra: string[] = [];
      if (actor.relationshipToProtagonist.stance.length > 0) {
        extra.push(`立场：${actor.relationshipToProtagonist.stance}`);
      }
      if (
        actor.presentation.outfit.label.length > 0 ||
        actor.presentation.outfit.details.length > 0
      ) {
        const outfitText =
          actor.presentation.outfit.details.length > 0
            ? `${actor.presentation.outfit.details}（${actor.presentation.outfit.label}）`
            : actor.presentation.outfit.label;
        extra.push(`外貌：${outfitText}`);
      }
      if (extra.length > 0) {
        return `${base} [${extra.join(" ")}]`;
      }
      return base;
    })
    .join(";");
}

function formatGmBriefFunds(publicState: PublicGameState): string {
  const purseLines = publicState.economy.accessibleFunds
    .map((purse) => `${purse.label}: ${formatAmount(purse.amount, purse.currencyType ?? "loen")}`)
    .join("、");
  return `可访问资金 ${purseLines}`;
}

/** 关键物品列表（GM 全可见，不按 player-known 过滤）。 */
function formatTrackedItemsBrief(publicState: PublicGameState): string[] {
  const items = Object.values(publicState.trackedItems).toSorted((left, right) =>
    left.label.localeCompare(right.label),
  );
  if (items.length === 0) return [];
  const itemLines = items.map((item) => {
    const holder =
      item.holderActorId === null
        ? "未携带"
        : (publicState.actors[item.holderActorId]?.presentation.renderName ?? item.holderActorId);
    const notes = item.notes.length > 0 ? ` · ${item.notes.join("；")}` : "";
    return `    - ${item.id}: ${item.label}（${item.kind} · ${item.condition} · ${holder}${notes}）`;
  });
  return [`  关键物品：`, ...itemLines];
}

/** 债务列表。 */
function formatDebts(publicState: PublicGameState): string[] {
  if (publicState.economy.debts.length === 0) return [];
  const debtLines = publicState.economy.debts.map((debt) => {
    const debtorName =
      publicState.actors[debt.debtorActorId]?.presentation.renderName ?? debt.debtorActorId;
    const reason = debt.reason.length > 0 ? `（${debt.reason}）` : "";
    return `    - ${debtorName} 欠 ${debt.creditor}：${formatAmount(debt.amount, "loen")}${reason}`;
  });
  return [`  债务：`, ...debtLines];
}

function formatCondition(
  condition: NonNullable<PublicGameState["actors"][string]>["condition"],
): string {
  const lines = condition.afflictions.map((effect) => {
    const base = `${effect.id}: ${effect.source}:${effect.text}`;
    return effect.expectedDuration !== null
      ? `${base}（预期${effect.expectedDuration}）`
      : base;
  });
  return lines.length === 0 ? "无显著状态效果" : lines.join("；");
}

/**
 * 将事件时间转为相对当前时间的描述（5分钟前 / 3小时前 / 2天前）。
 */
function formatRelativeEventTime(eventIso: string, currentIso: string): string {
  const minutes = diffMinutes(eventIso, currentIso);
  if (minutes <= 0) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return formatHumanTime(eventIso).display;
}

function formatRecentEvents(publicState: PublicGameState): string {
  const recent = publicState.memory.eventLog.slice(-3);
  return recent.length === 0
    ? "无"
    : recent
        .map((event) => {
          const consequences =
            event.consequences.length > 0 ? ` → ${event.consequences.join(";")}` : "";
          const relativeTime = formatRelativeEventTime(event.time, publicState.clock.currentAt);
          return `${event.title}：${event.summary}${consequences}（${relativeTime}）`;
        })
        .join(";");
}

function formatPinnedFacts(publicState: PublicGameState): string[] {
  const facts = publicState.memory.pinnedFacts.slice(-3);
  if (facts.length === 0) return [];
  return [
    "固定事实：",
    ...facts.map(
      (fact) =>
        `    [${fact.scope}] ${fact.text}`,
    ),
  ];
}

function formatScheduledEvents(
  publicState: PublicGameState,
  secrets?: SecretGameState,
): string[] {
  const events = secrets?.scheduledEvents;
  if (events === undefined || events.length === 0) return [];
  const currentAt = publicState.clock.currentAt;
  return [
    "待办日程：",
    ...events.map((event) => {
      const time = formatHumanTime(event.dueAt, publicState.clock.timezone);
      const minDiff = diffMinutes(event.dueAt, currentAt);
      const prefix =
        minDiff <= 0
          ? "⚠️ 已到期！"
          : minDiff < 60
            ? `${minDiff}分钟后`
            : minDiff < 1440
              ? `${Math.floor(minDiff / 60)}小时后`
              : `${Math.floor(minDiff / 1440)}天后`;
      return `    ${event.id}: ${event.summary}（${time.display} · ${prefix}）`;
    }),
  ];
}
function formatSecretsGlance(
  publicState: PublicGameState,
  secrets?: SecretGameState,
): string[] {
  if (secrets === undefined) return [];
  const icons: Record<string, string> = { hidden: "🔒", foreshadowed: "🔮", revealed: "✅" };

  // 主角秘密
  const protagonistSecrets = secrets.actorStates[publicState.protagonistActorId];
  const protagonistLines: string[] = [];
  if (protagonistSecrets?.secrets !== undefined) {
    for (const [label, slots] of [
      ["非凡", protagonistSecrets.secrets.beyonderSecrets],
      ["动机", protagonistSecrets.secrets.privateMotives],
      ["关联", protagonistSecrets.secrets.unrevealedAffiliations],
    ] as const) {
      const counts = new Map<string, number>();
      for (const slot of slots) {
        const key = icons[slot.revealState] ?? "?";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [icon, count] of counts) {
        protagonistLines.push(`${label}${icon}${count}`);
      }
    }
  }

  // 世界隐藏事实（未揭示的）
  const worldFacts = secrets.hiddenWorldFacts.filter(
    (fact) => fact.revealState !== "revealed"
  );

  // 最近揭示事件
  const recentReveals = secrets.secretEventLog.slice(-2).map(
    (event) => {
      const time = formatHumanTime(event.time, publicState.clock.timezone);
      const actors = event.relatedActorIds.length > 0
        ? `（${event.relatedActorIds.join("、")}）`
        : "";
      return `${time.display}：${event.summary}${actors}`;
    },
  );

  const hasAny =
    protagonistLines.length > 0 ||
    worldFacts.length > 0 ||
    recentReveals.length > 0;
  if (!hasAny) return [];

  const summary: string[] = [];
  if (protagonistLines.length > 0) {
    const name =
      publicState.actors[publicState.protagonistActorId]?.presentation.renderName ??
      publicState.protagonistActorId;
    summary.push(`主角（${name}）：${protagonistLines.join(" ")}`);
  }
  if (worldFacts.length > 0) {
    summary.push(`世界隐藏事实：${worldFacts.length}项🔒`);
  }

  const lines: string[] = ["秘密纵览："];
  lines.push(...summary.map((s) => `  · ${s}`));
  if (recentReveals.length > 0) {
    lines.push("  最近揭示：", ...recentReveals.map((r) => `    - ${r}`));
  }
  lines.push("  （summarize_secrets 查看完整秘密状态）");
  return lines;
}

function formatTurnLog(publicState: PublicGameState): string[] {
  const entries = publicState.turnLog.slice(-3);
  if (entries.length === 0) return [];
  return [
    "最近轮次：",
    ...entries.map((entry) => {
      const timeDesc =
        entry.time.kind === "travel"
          ? `travel → ${entry.time.location.region}·${entry.time.location.site}·${entry.time.location.detail}`
          : `elapsed${entry.time.reason.length > 0 ? `: ${entry.time.reason}` : ""}`;
      return `    ${entry.id}: ${entry.summary}（${timeDesc}, +${entry.time.elapsedMinutes}min, ${entry.eventCount}事件）`;
    }),
  ];
}

function formatRecentRelationshipSignals(publicState: PublicGameState): string {
  const recent = recentPlayerKnownRelationshipSignals(publicState, 4);
  return recent.length === 0
    ? "无"
    : recent
        .map(
          (signal) =>
            `${publicState.actors[signal.actorId]?.presentation.renderName ?? signal.actorId}→${publicState.actors[signal.targetActorId]?.presentation.renderName ?? signal.targetActorId}：${signal.signal}（边界：${signal.boundary}）`,
        )
        .join("；");
}

function formatPresentActors(publicState: PublicGameState): string {
  const names = publicState.scene.presentActorIds.map(
    (actorId) => publicState.actors[actorId]?.presentation.renderName ?? actorId,
  );
  return names.length === 0 ? "无" : names.join("、");
}

function formatFunds(publicState: PublicGameState): string {
  if (publicState.economy.accessibleFunds.length === 0) {
    return "- 无可访问资金";
  }
  return publicState.economy.accessibleFunds
    .map((purse) => {
      const owner =
        purse.ownerActorId === publicState.protagonistActorId
          ? "你"
          : (publicState.actors[purse.ownerActorId]?.presentation.renderName ?? purse.ownerActorId);
      const accessTag =
        purse.access === "held" ? "随身持有" : purse.access === "shared" ? "共享" : "需许可";
      return `- ${purse.label}（${owner} · ${accessTag}）：${formatAmount(purse.amount, purse.currencyType ?? "loen")}`;
    })
    .join("\n");
}

function formatTrackedItems(publicState: PublicGameState): string {
  const items = Object.values(publicState.trackedItems)
    .filter((item) => item.visibility === "player-known")
    .toSorted((left, right) => left.label.localeCompare(right.label));
  if (items.length === 0) {
    return "- 无关键物品";
  }
  return items
    .map((item) => {
      const holder =
        item.holderActorId === null
          ? "未随身持有"
          : (publicState.actors[item.holderActorId]?.presentation.renderName ?? item.holderActorId);
      const notes = item.notes.length === 0 ? "" : `；${item.notes.join("；")}`;
      return `- ${item.id}: ${item.label}（${holder}；${item.condition}${notes}）`;
    })
    .join("\n");
}

function formatOrdinaryItems(publicState: PublicGameState): string {
  const lines = Object.values(publicState.actors)
    .filter((actor) => actor.inventory.items.length > 0)
    .map((actor) => `- ${actor.presentation.renderName}：${actor.inventory.items.join("、")}`);
  return lines.length === 0 ? "- 无记录" : lines.join("\n");
}
