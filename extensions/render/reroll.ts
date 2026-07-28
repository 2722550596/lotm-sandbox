import type {
  CustomMessageEntry,
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

import type { RenderDirectionPacket } from "../../engine/direction/packet-schema.ts";
import type { PendingDirectionPacket } from "../../engine/direction/render-turn.ts";

import { randomUUID } from "node:crypto";

import {
  PROSE_CUSTOM_TYPE,
  findPendingDirectionPacket,
} from "../../engine/direction/render-turn.ts";
import { pruneAbandonedSubtree } from "../rewind/prune.ts";

export interface RerollRenderedProse {
  text: string;
  lintRuleIds: readonly string[];
}

interface RenderablePendingDirectionPacket {
  packet: RenderDirectionPacket;
  toolCallId: string;
}

interface RerollCommandCallbacks {
  render(
    ctx: ExtensionCommandContext,
    messages: ReadonlyArray<unknown>,
    packet: RenderDirectionPacket,
    variantKey: string,
  ): Promise<RerollRenderedProse | undefined>;
  afterSend?(
    ctx: ExtensionCommandContext,
    pending: RenderablePendingDirectionPacket,
    prose: string,
  ): void;
  cleanup?(ctx: ExtensionCommandContext): void;
}

export interface ReadyRerollTarget {
  kind: "ready";
  proseEntry: CustomMessageEntry;
  parentId: string;
  pending: PendingDirectionPacket;
  renderMessages: ReadonlyArray<unknown>;
}

export type RerollTarget =
  | ReadyRerollTarget
  | { kind: "no-prose" }
  | { kind: "not-leaf"; proseEntryId: string; leafId: string | null }
  | { kind: "root-prose"; proseEntryId: string }
  | { kind: "no-packet"; proseEntryId: string };

export function registerRerollCommand(pi: ExtensionAPI, callbacks: RerollCommandCallbacks): void {
  pi.registerCommand("reroll-narrative", {
    description:
      "重新渲染最后一条正文：保留结算事实，只替换可见小说文本（改名自 /reroll 以免冲突）",
    handler: async (args, ctx) => {
      if (args.trim() !== "") {
        ctx.ui.notify("用法：/reroll-narrative — 只重 roll 当前最后一条正文，不接参数", "warning");
        return;
      }
      await rerollLastProse(pi, callbacks, ctx);
    },
  });
}

export function findRerollTarget(branch: readonly SessionEntry[]): RerollTarget {
  const proseIndex = findLastProseIndex(branch);
  if (proseIndex === undefined) {
    return { kind: "no-prose" };
  }
  const proseEntry = branch[proseIndex];
  if (proseEntry === undefined || !isProseEntry(proseEntry)) {
    return { kind: "no-prose" };
  }

  const blockingEntry = branch.slice(proseIndex + 1).find(isMessageEntry);
  if (blockingEntry !== undefined) {
    return { kind: "not-leaf", proseEntryId: proseEntry.id, leafId: blockingEntry.id };
  }
  if (proseEntry.parentId === null) {
    return { kind: "root-prose", proseEntryId: proseEntry.id };
  }

  const renderMessages = sessionEntriesToRendererMessages(branch.slice(0, proseIndex));
  const pending = findPendingDirectionPacket(renderMessages);
  if (pending === undefined) {
    return { kind: "no-packet", proseEntryId: proseEntry.id };
  }
  return { kind: "ready", proseEntry, parentId: proseEntry.parentId, pending, renderMessages };
}

export function sessionEntriesToRendererMessages(entries: readonly SessionEntry[]): unknown[] {
  const messages: unknown[] = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      messages.push(entry.message);
    } else if (entry.type === "custom_message") {
      messages.push(customEntryToMessage(entry));
    }
  }
  return messages;
}

export function isRerollTargetStillCurrent(
  branch: readonly SessionEntry[],
  target: ReadyRerollTarget,
): boolean {
  const current = findRerollTarget(branch);
  return (
    current.kind === "ready" &&
    current.proseEntry.id === target.proseEntry.id &&
    current.parentId === target.parentId &&
    current.pending.toolCallId === target.pending.toolCallId
  );
}

async function rerollLastProse(
  pi: ExtensionAPI,
  callbacks: RerollCommandCallbacks,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.isIdle()) {
    ctx.ui.notify("当前仍在生成；等本轮正文落地后再 /reroll-narrative", "warning");
    return;
  }

  const target = findRerollTarget(ctx.sessionManager.getBranch());
  if (target.kind !== "ready") {
    ctx.ui.notify(rerollProblemMessage(target), "warning");
    return;
  }

  const packet = target.pending.packet;
  if (!packet.needsRender) {
    ctx.ui.notify("上一条是直答/系统回复，不是可重 roll 的正文", "warning");
    return;
  }

  await renderAndReplaceProse(pi, callbacks, ctx, target, {
    packet,
    toolCallId: target.pending.toolCallId,
  });
}

async function renderAndReplaceProse(
  pi: ExtensionAPI,
  callbacks: RerollCommandCallbacks,
  ctx: ExtensionCommandContext,
  target: ReadyRerollTarget,
  pending: RenderablePendingDirectionPacket,
): Promise<void> {
  try {
    ctx.ui.setWorkingMessage("重 roll 本轮正文…");
    const prose = await callbacks.render(ctx, target.renderMessages, pending.packet, randomUUID());
    if (prose === undefined) {
      ctx.ui.notify("正文 reroll 失败：渲染器不可用，已保留原正文", "warning");
      return;
    }
    if (!isRerollTargetStillCurrent(ctx.sessionManager.getBranch(), target)) {
      ctx.ui.notify("会话位置已变化，取消替换旧正文", "warning");
      return;
    }

    const editorText = ctx.ui.getEditorText();
    const navigation = await ctx.navigateTree(target.parentId, { summarize: false });
    ctx.ui.setEditorText(editorText);
    if (navigation.cancelled) {
      ctx.ui.notify("reroll 已取消，原正文未改动", "warning");
      return;
    }

    const pruned = pruneAbandonedSubtree(ctx.sessionManager, target.proseEntry.id, target.parentId);
    sendRerolledProse(pi, target, prose, pending.packet.suggestedActions);
    callbacks.afterSend?.(ctx, pending, prose.text);
    ctx.ui.notify(rerollSuccessMessage({ pruned }), "info");
  } catch (error) {
    ctx.ui.notify(`正文 reroll 失败：${formatError(error)}`, "error");
  } finally {
    callbacks.cleanup?.(ctx);
    ctx.ui.setWorkingMessage(undefined);
  }
}

function sendRerolledProse(
  pi: ExtensionAPI,
  target: ReadyRerollTarget,
  prose: RerollRenderedProse,
  suggestedActions: RenderDirectionPacket["suggestedActions"],
): void {
  pi.sendMessage(
    {
      customType: PROSE_CUSTOM_TYPE,
      content: prose.text,
      display: true,
      details: {
        kind: "rerolled",
        replacedEntryId: target.proseEntry.id,
        toolCallId: target.pending.toolCallId,
        lintRuleIds: prose.lintRuleIds,
        // 必须随重 roll 的正文一起持久化，否则 /choice 的 findLatestChoiceSet 读这条
        // 新 prose 时拿不到候选，widget 显示候选、选择却报「无可用候选」。
        ...(suggestedActions === undefined ? {} : { suggestedActions }),
      },
    },
    { triggerTurn: false },
  );
}

function findLastProseIndex(branch: readonly SessionEntry[]): number | undefined {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry !== undefined && isProseEntry(entry)) {
      return index;
    }
  }
  return undefined;
}

function isProseEntry(entry: SessionEntry): entry is CustomMessageEntry {
  return entry.type === "custom_message" && entry.customType === PROSE_CUSTOM_TYPE;
}

function isMessageEntry(entry: SessionEntry): boolean {
  return entry.type === "message";
}

function customEntryToMessage(entry: CustomMessageEntry): Record<string, unknown> {
  const timestamp = Date.parse(entry.timestamp);
  return {
    role: "custom",
    customType: entry.customType,
    content: entry.content,
    display: entry.display,
    details: entry.details,
    timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
  };
}

function rerollProblemMessage(target: Exclude<RerollTarget, ReadyRerollTarget>): string {
  switch (target.kind) {
    case "no-prose":
      return "当前分支还没有可重 roll 的正文";
    case "not-leaf":
      return "只能重 roll 当前最后一条正文；如果已经继续输入，先用 /fuck 回到那一轮";
    case "root-prose":
      return "最后一条正文缺少父节点，无法安全替换";
    case "no-packet":
      return "找不到这条正文对应的结算包，无法只重 roll 文本";
    default:
      return "当前正文无法安全重 roll";
  }
}

function rerollSuccessMessage(result: { pruned: boolean }): string {
  return result.pruned
    ? "已重 roll 最后一条正文；结算事实与游戏状态未改变，旧正文已删除"
    : "已重 roll 最后一条正文；结算事实与游戏状态未改变（旧正文分支未物理删除）";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
