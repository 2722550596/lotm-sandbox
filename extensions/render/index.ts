import type {
  ExtensionAPI,
  ExtensionContext,
  MessageRenderer,
} from "@earendil-works/pi-coding-agent";

import type {
  RenderDirectionPacket,
  SuggestedAction,
} from "../../engine/direction/packet-schema.ts";

import { stream, streamSimple } from "@earendil-works/pi-ai";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";

import { collectUnrevealedSecretStrings } from "../../engine/audit/lint-rules.ts";
import { syncStateFromSessionManager } from "../../engine/core/state/session-persistence.ts";
import { getState } from "../../engine/core/state/state-store.ts";
import { isRecord } from "../../engine/core/utils/typebox-validation.ts";
import {
  loadProseDigests,
  migrateOldProseDigestFile,
  saveProseDigest,
} from "../../engine/direction/prose-digest-store.ts";
import {
  buildLintRetryMessages,
  buildRendererMessages,
  findPendingDirectionPacket,
  lintRenderedProse,
  type PendingDirectionPacket,
  PROSE_CUSTOM_TYPE,
  redactSecrets,
  type RendererMessage,
} from "../../engine/direction/render-turn.ts";
import { stripLeakedSettlementProse } from "../../engine/direction/settlement-prose-firewall.ts";
import {
  stripThinkingResidue,
  THINKING_PREFILL_TEXT,
} from "../../engine/direction/strip-thinking.ts";
import { buildRendererSystemPrompt } from "../../engine/gm-prompt/injection.ts";
import { setChoiceWidget } from "../player-choices/index.ts";
import { registerRerollCommand } from "./reroll.ts";

const RENDERER_MAX_TOKENS = 8192;
const DEFAULT_RENDER_LINT_RETRIES = 3;
const MAX_RENDER_LINT_RETRIES = 6;
/** 伪流式预览 widget：只展示尾部若干行，避免长正文压满屏幕。 */
const RENDER_WIDGET_KEY = "fsn-render-preview";
const RENDER_WIDGET_TAIL_LINES = 12;
/** 等待 run 真正空闲的轮询间隔与上限（约 10s）。 */
const IDLE_POLL_INTERVAL_MS = 25;
const IDLE_POLL_MAX_ATTEMPTS = 400;

/**
 * 双 pass 第二段（Pass B）：结算循环以 submit_direction_packet 收尾后，
 * 在 agent_end 用洁净室 complete() 把 packet 渲染成玩家可见正文，
 * 以 fsn-prose custom message 落 session。结算投影的过滤在 extension.ts。
 *
 * 注意：agent_end 触发时 run 仍处于 streaming 态（finishRun 在监听器之后），
 * 此时 sendMessage 会被当成 steer 输入再唤醒结算器，形成自激振荡。
 * 所以发送必须延迟到 ctx.isIdle() 之后；另用 toolCallId 去重防双渲。
 */
export default function twoPassRenderExtension(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(PROSE_CUSTOM_TYPE, renderProseMessage);
  // 一次性迁移：旧 state/prose-digests.json → state/prose-digests/_legacy.json
  migrateOldProseDigestFile();
  registerRerollCommand(pi, {
    render: (ctx, messages, packet, variantKey) => {
      syncStateFromSessionManager(ctx.sessionManager);
      const unrevealedSecrets = collectUnrevealedSecretStrings(getState().secrets);
      return renderProse(ctx, messages, packet, unrevealedSecrets, { variantKey });
    },
    afterSend: (ctx, pending, prose) => {
      if (pending.packet.needsRender) {
        setChoiceWidget(ctx, pending.packet.suggestedActions ?? []);
      }
      void writeTurnDigest(ctx, pending, prose);
    },
    cleanup: clearRenderWidget,
  });

  // Pass A 漏稿源头收口：结算回合的 assistant 消息只该带工具调用，模型偶尔在
  // 旁边漏出正文（玩家从未看到、却会落史回喂并与 canonical prose 分叉）。在消息
  // 定稿时剥掉这类 text 部件。渲染器 Pass B 走裸 stream()，不触发本钩子。
  pi.on("message_end", async (event) => {
    const stripped = stripLeakedSettlementProse(event.message);
    return stripped === undefined ? undefined : { message: stripped };
  });

  const renderedToolCallIds = new Set<string>();

  pi.on("agent_end", async (event, ctx) => {
    const pending = readPendingPacket(event.messages, ctx);
    if (pending === undefined || renderedToolCallIds.has(pending.toolCallId)) {
      return;
    }
    renderedToolCallIds.add(pending.toolCallId);
    const { packet } = pending;
    if (!packet.needsRender) {
      sendProseWhenIdle(pi, ctx, packet.directReply, { kind: "direct-reply" });
      return;
    }
    syncStateFromSessionManager(ctx.sessionManager);
    const unrevealedSecrets = collectUnrevealedSecretStrings(getState().secrets);
    const prose = await renderProse(ctx, event.messages, packet, unrevealedSecrets);
    if (prose === undefined) {
      sendProseWhenIdle(pi, ctx, buildFallbackProse(packet), { kind: "render-fallback" });
      return;
    }
    sendProseWhenIdle(pi, ctx, prose.text, {
      kind: "rendered",
      lintRuleIds: prose.lintRuleIds,
      suggestedActions: packet.suggestedActions,
    });
    // backlog #13：独立 writer 异步产出本轮高质量摘要，供后续轮次的摘要层使用。
    // 失败静默——机械 packet 摘要永远是兜底。
    void writeTurnDigest(ctx, pending, prose.text);
  });
}

/**
 * 等 run 退出 streaming 态后再落 prose：此时 sendMessage 走「非 streaming +
 * 不触发」分支，只追加消息不开新轮。若玩家抢先开了新轮，则继续等到
 * 那轮结束，最多约 10s 后放弃并告警。
 */
function sendProseWhenIdle(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  text: string,
  details: Record<string, unknown>,
  attempt = 0,
): void {
  if (ctx.isIdle()) {
    sendProse(pi, text, details);
    const suggestedActions = readSuggestedActionsFromDetails(details);
    setChoiceWidget(ctx, suggestedActions);
    clearRenderWidget(ctx);
    return;
  }
  if (attempt >= IDLE_POLL_MAX_ATTEMPTS) {
    clearRenderWidget(ctx);
    notify(ctx, "two-pass render: agent never went idle, dropping prose delivery", "error");
    return;
  }
  setTimeout(() => {
    sendProseWhenIdle(pi, ctx, text, details, attempt + 1);
  }, IDLE_POLL_INTERVAL_MS);
}

interface RenderedProse {
  text: string;
  lintRuleIds: string[];
}

function rendererNameEntries(state: ReturnType<typeof getState>): Array<{
  actorId: string;
  canonicalName: string;
  renderName: string;
}> {
  // 每个具名 actor 都需要绑定 renderName，防止渲染器重新音译（例：Manaka 被随机译成不同中文）。
  // 不能只在 renderName !== canonicalName 时才发；那样同名（常见情况）会丢掉所有锚点。
  return Object.values(state.public.actors).map((actor) => ({
    actorId: actor.id,
    canonicalName: actor.presentation.canonicalName,
    renderName: actor.presentation.renderName,
  }));
}

interface RenderProseOptions {
  variantKey?: string;
}

async function renderProse(
  ctx: ExtensionContext,
  loopMessages: ReadonlyArray<unknown>,
  packet: RenderDirectionPacket,
  unrevealedSecrets: readonly string[],
  options: RenderProseOptions = {},
): Promise<RenderedProse | undefined> {
  const model = resolveRendererModel(ctx);
  if (model === undefined) {
    notify(ctx, "two-pass render: no active model, falling back to packet digest", "warning");
    return undefined;
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || auth.apiKey === undefined) {
    notify(
      ctx,
      "two-pass render: model auth unavailable, falling back to packet digest",
      "warning",
    );
    return undefined;
  }

  const systemPrompt = buildRendererSystemPrompt();
  const state = getState();
  const baseMessages = buildRendererMessages(
    loopMessages,
    packet,
    loadProseDigests(ctx.sessionManager.getSessionId()),
    rendererNameEntries(state),
    state,
  );
  const rendererMessages =
    options.variantKey === undefined
      ? baseMessages
      : buildRerollRendererMessages(baseMessages, options.variantKey);

  try {
    setWorking(ctx, "渲染本轮正文…");
    let draft = await streamProse(
      ctx,
      model,
      auth,
      systemPrompt,
      rendererMessages,
      "渲染中",
      "render",
    );
    let report = lintRenderedProse(draft, unrevealedSecrets, packet);
    if (report.findings.length === 0) {
      return { text: draft, lintRuleIds: [] };
    }

    const maxRetries = resolveRenderLintRetries(ctx);
    for (let retryIndex = 1; retryIndex <= maxRetries; retryIndex++) {
      setWorking(ctx, `文风返工重写中…(${retryIndex}/${maxRetries})`);
      draft = await streamProse(
        ctx,
        model,
        auth,
        systemPrompt,
        buildLintRetryMessages(rendererMessages, draft, report.findings),
        `重写中 ${retryIndex}/${maxRetries}`,
        "lint-retry",
      );
      report = lintRenderedProse(draft, unrevealedSecrets, packet);
      if (report.findings.length === 0) {
        return { text: draft, lintRuleIds: [] };
      }
    }

    const lintRuleIds = report.findings.map((finding) => finding.ruleId);
    if (report.leaks.length > 0) {
      notify(ctx, "two-pass render: secret leak persisted after retries, redacted", "error");
      return { text: redactSecrets(draft, unrevealedSecrets), lintRuleIds };
    }
    notify(ctx, `two-pass render: style findings remain (${lintRuleIds.join(", ")})`, "warning");
    return { text: draft, lintRuleIds };
  } catch (error) {
    notify(ctx, `two-pass render failed (${formatError(error)}), falling back`, "warning");
    return undefined;
  } finally {
    setWorking(ctx, undefined);
  }
}

function buildRerollRendererMessages(
  baseMessages: readonly RendererMessage[],
  variantKey: string,
): RendererMessage[] {
  return [
    ...baseMessages,
    {
      role: "user",
      text: [
        "# Reroll Request",
        "",
        "Rewrite this same turn from scratch. Preserve every binding fact in the Direction Packet exactly: no new outcomes, time jumps, secret reveals, injuries, items, money changes, or relationship changes.",
        "Change only the visible prose surface: pacing, sentence shape, sensory focus, blocking, and dialogue texture.",
        `Variant key: ${variantKey}`,
      ].join("\n"),
    },
  ];
}

/**
 * 伪流式渲染：逐 token 把正文尾部画进编辑器上方的 widget，让玩家看到
 * 正文在生长；最终文本仍走 lint 门禁后以 fsn-prose 消息落地。
 * widget 在 prose 送达时清除（sendProse），失败路径在这里自清。
 */
/**
 * Anthropic/Claude 渠道拒绝以 assistant 消息结尾的 prefill（400 "does not support
 * assistant message prefill"）。优先查模型名含 claude（覆盖 Claude 经 OpenRouter /
 * 其他代理的情况，此时 provider 未必是 anthropic），再补 provider==anthropic 兑底。
 * Claude 原生 thinking 走独立通道、不污染 text_delta，本就不需 prefill；后置
 * stripThinkingResidue 仍是兜底。
 */
export function supportsAssistantPrefill(model: { id: string; provider: string }): boolean {
  if (model.id.toLowerCase().includes("claude")) {
    return false;
  }
  return model.provider !== "anthropic";
}

async function streamProse(
  ctx: ExtensionContext,
  model: NonNullable<ExtensionContext["model"]>,
  auth: { apiKey?: string; headers?: Record<string, string> },
  systemPrompt: string,
  rendererMessages: readonly RendererMessage[],
  label: string,
  usageKind: RenderCallKind,
): Promise<string> {
  // 卡掉原生思维链（参 strip-thinking.ts 文档头）：在最终送入 stream() 前追加一条
  // assistant prefill。三条调用路径（首写、lint 重写、reroll 变体）都收敛在这里，
  // 避免多处分别维护。不动 buildRendererMessages 原件：reroll 路径会在后面接 user
  // 请求，在那边插 prefill 会被后续 user 消息顶掉。
  //
  // Anthropic/Claude 渠道（尤其 OAuth 适配器）拒绝以 assistant 消息结尾的 prefill
  // （400 "does not support assistant message prefill"）。Claude 原生 thinking 走
  // 独立通道、不会污染 text_delta，本就不需要这条 prefill；后置 stripThinkingResidue
  // 仍是兜底。故 anthropic 直接跳过 prefill，让对话以 user 消息结尾。
  const baseStreamMessages = rendererMessages.map((message) => toStreamMessage(message, model));
  const streamMessages = supportsAssistantPrefill(model)
    ? [
        ...baseStreamMessages,
        toStreamMessage({ role: "assistant", text: THINKING_PREFILL_TEXT }, model),
      ]
    : baseStreamMessages;
  const events = stream(
    model,
    {
      systemPrompt,
      messages: streamMessages,
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      maxTokens: RENDERER_MAX_TOKENS,
      temperature: resolveRenderTemperature(ctx),
      // 渲染器有自己的稳定前缀（分层散文史），独立缓存分区提升命中率。
      sessionId: rendererSessionId(ctx, "render"),
      // 实测 OAuth 渠道不 honor 1h TTL（静默按 5m 处理），默认 short 免付 2× 写价；
      // 渠道哪天生效了可用 RENDER_CACHE=long 打开。
      cacheRetention: resolveRenderCacheRetention(ctx),
    },
  );
  let draft = "";
  try {
    for await (const event of events) {
      if (event.type === "text_delta") {
        draft += event.delta;
        updateRenderWidget(ctx, label, draft);
      } else if (event.type === "done") {
        captureUsage(ctx, usageKind, event.message.usage);
      } else if (event.type === "error") {
        throw new Error(event.error.errorMessage ?? "renderer stream failed");
      }
    }
  } catch (error) {
    clearRenderWidget(ctx);
    throw error instanceof Error ? error : new Error(String(error));
  }
  // 后置剥离：prefill 被某些中转吞掉时的兜底，同时清掉模型自己写在中间的闭合
  // <think>…</think> 段。必须在 trim 前跳过：变成空串走上面的 empty 分支触发重试。
  const text = stripThinkingResidue(draft);
  if (text === "") {
    clearRenderWidget(ctx);
    throw new Error("renderer returned empty prose");
  }
  return text;
}

type StreamMessage = Parameters<typeof stream>[1]["messages"][number];

interface DoneUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { total: number };
}

type RenderCallKind = "render" | "lint-retry" | "digest";

/** Pass B 会话内累计用量（不落盘）；只供 widget 展示。 */
const usageTotals = {
  calls: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costTotal: 0,
  lastTurnTokens: 0,
  lastTurnDetail: "",
  /** 某些中转渠道明细字段失真，明细对不上 total。 */
  detailsUnreliable: false,
};

/** 明细与总数偏差超过 10% 即认为 provider 报数不全。 */
function usageDetailsConsistent(usage: DoneUsage): boolean {
  if (usage.totalTokens === 0) {
    return true;
  }
  const sum = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  return Math.abs(sum - usage.totalTokens) <= usage.totalTokens * 0.1;
}

const USAGE_WIDGET_KEY = "fsn-render-usage";

/** 接住 done 事件的 usage，累进会话总账并刷新 widget；失败不阻塞渲染。 */
function captureUsage(ctx: ExtensionContext, kind: RenderCallKind, usage: DoneUsage): void {
  try {
    usageTotals.calls += 1;
    usageTotals.input += usage.input;
    usageTotals.output += usage.output;
    usageTotals.cacheRead += usage.cacheRead;
    usageTotals.cacheWrite += usage.cacheWrite;
    usageTotals.totalTokens += usage.totalTokens;
    usageTotals.costTotal += usage.cost.total;
    if (kind !== "digest") {
      usageTotals.lastTurnTokens = usage.totalTokens;
      usageTotals.lastTurnDetail = `in ${usage.input} / out ${usage.output} / cacheR ${usage.cacheRead} / cacheW ${usage.cacheWrite}`;
    }
    if (!usageDetailsConsistent(usage)) {
      usageTotals.detailsUnreliable = true;
    }
    if (!ctx.hasUI) {
      return;
    }
    const cost = usageTotals.costTotal > 0 ? ` · $${usageTotals.costTotal.toFixed(4)}` : "";
    // 明细不可信时只展示 total（total_tokens 始终由 provider 直报，可信）。
    const turnDetail = usageTotals.detailsUnreliable ? "" : `（${usageTotals.lastTurnDetail}）`;
    const breakdown = usageTotals.detailsUnreliable
      ? "（明细略：渠道报数不全）"
      : `（in ${usageTotals.input} / out ${usageTotals.output} / cacheR ${usageTotals.cacheRead} / cacheW ${usageTotals.cacheWrite}）`;
    const line =
      `Pass B 用量 · 本轮 ${usageTotals.lastTurnTokens} tok${turnDetail} · 累计 ${usageTotals.totalTokens} tok` +
      `${breakdown} · ${usageTotals.calls} 次调用${cost}`;
    // 与内置状态提示（如 Navigated to selected point）同源的质感：
    // 主题 dim 色 + 斜体，随主题切换，不和正文争视线。
    ctx.ui.setWidget(
      USAGE_WIDGET_KEY,
      (_tui, theme) => new Text(theme.italic(theme.fg("dim", line)), 1, 0),
    );
  } catch {
    // 静默：widget 展示问题不阻塞渲染。
  }
}

/** RendererMessage → pi-ai 消息；assistant 位需要补齐元数据字段（历史正文伪装成模型旧产出）。 */
function toStreamMessage(
  message: RendererMessage,
  model: NonNullable<ExtensionContext["model"]>,
): StreamMessage {
  if (message.role === "user") {
    return { role: "user", content: [{ type: "text", text: message.text }], timestamp: 0 };
  }
  return {
    role: "assistant",
    content: [{ type: "text", text: message.text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

function updateRenderWidget(ctx: ExtensionContext, label: string, draft: string): void {
  if (!ctx.hasUI) {
    return;
  }
  const lines = draft.split("\n");
  const tail = lines.slice(-RENDER_WIDGET_TAIL_LINES);
  ctx.ui.setWidget(RENDER_WIDGET_KEY, [`── ${label} ──`, ...tail]);
}

function clearRenderWidget(ctx: ExtensionContext): void {
  if (ctx.hasUI) {
    ctx.ui.setWidget(RENDER_WIDGET_KEY, undefined);
  }
}

/** writer 摘要输出上限：单行摘要，给推理余量。 */
const DIGEST_MAX_TOKENS = 512;

/**
 * 独立 digest writer（backlog #13）：渲染完成后异步把本轮压成一行摘要
 * 写入 prose-digest store。不阻塞主循环，失败静默（机械摘要兑底）。
 */
async function writeTurnDigest(
  ctx: ExtensionContext,
  pending: PendingDirectionPacket,
  prose: string,
): Promise<void> {
  try {
    const model = resolveDigestModel(ctx);
    if (model === undefined) {
      return;
    }
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || auth.apiKey === undefined) {
      return;
    }
    const { packet } = pending;
    const prompt = [
      "用一行中文（≤80 字，不换行）写这一轮的前情提要，像小说卷首的上轮回顾：谁做了什么、关系/态度怎么变了、留下了什么悬念。",
      "写成自然叙述的一句话，不用箭头、不用分号堆砌、不列术语清单；只要事实准确，不要报告腔，不要前缀标号。",
      "",
      `玩家行动：${packet.needsRender ? packet.playerAction : "（meta 轮）"}`,
      `已结算事实：${packet.needsRender ? packet.resolvedChanges.join("；") : "无"}`,
      "",
      "本轮正文：",
      prose,
    ].join("\n");
    // 摘要是纯压缩活：推理模型降到最低档，省 token 也更快；非推理模型不传。
    const events = streamSimple(
      model,
      {
        systemPrompt: "你是叙事存档员，只输出一行自然叙述的前情提要。",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: 0 }],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: DIGEST_MAX_TOKENS,
        reasoning: model.reasoning ? "minimal" : undefined,
        sessionId: rendererSessionId(ctx, "digest"),
      },
    );
    let digest = "";
    for await (const event of events) {
      if (event.type === "text_delta") {
        digest += event.delta;
      } else if (event.type === "done") {
        captureUsage(ctx, "digest", event.message.usage);
      } else if (event.type === "error") {
        return;
      }
    }
    saveProseDigest(ctx.sessionManager.getSessionId(), pending.toolCallId, digest);
  } catch {
    // 静默：摘要缺位时渲染自动回退机械 packet 摘要。
  }
}

/**
 * Pass B 的缓存/路由标识：复用 pi session id，加后缀与结算循环、
 * digest writer 互相隔离——三条调用链前缀各不相同，混用同一分区
 * 反而稀释 sticky 路由的前缀缓存。不支持 sessionId 的 provider 会忽略。
 */
function rendererSessionId(ctx: ExtensionContext, suffix: string): string {
  return `${ctx.sessionManager.getSessionId()}:${suffix}`;
}

type CacheRetention = "none" | "short" | "long";

/**
 * 渲染器缓存保留档：默认 short（Anthropic 5m，写价 1.25×）。
 * 实测 Claude OAuth 渠道不 honor `ttl: "1h"`，静默按 5m 处理——long 档
 * 只多付 2× 写价不换任何保留；`RENDER_CACHE=long|none` 可覆盖。
 * digest writer 前缀不复用，不走这个档。
 */
function resolveRenderCacheRetention(ctx: ExtensionContext): CacheRetention {
  const raw = process.env["RENDER_CACHE"]?.trim();
  if (raw === undefined || raw === "") {
    return "short";
  }
  if (raw === "none" || raw === "short" || raw === "long") {
    return raw;
  }
  notify(ctx, `RENDER_CACHE 应为 none|short|long，得到：${raw}，已回退 short`, "warning");
  return "short";
}

/**
 * 文风 lint 失败后的整轮重写次数。默认 3 次；`RENDER_LINT_RETRIES=0`
 * 可关闭自动返工，最大 6 次避免坏模型烧空上下文和预算。
 */
function resolveRenderLintRetries(ctx: ExtensionContext): number {
  const raw = process.env["RENDER_LINT_RETRIES"]?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_RENDER_LINT_RETRIES;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_RENDER_LINT_RETRIES) {
    notify(
      ctx,
      `RENDER_LINT_RETRIES 应为 0~${MAX_RENDER_LINT_RETRIES} 的整数，得到：${raw}，已回退 ${DEFAULT_RENDER_LINT_RETRIES}`,
      "warning",
    );
    return DEFAULT_RENDER_LINT_RETRIES;
  }
  return value;
}

/**
 * 渲染器 temperature：`RENDER_TEMPERATURE=0.9` 之类。默认不传
 * （部分 provider/模型拒绝该参数，误传会让每轮渲染都回退机械摘要）；
 * 设了但解析不出或越界时告警并忽略。
 */
function resolveRenderTemperature(ctx: ExtensionContext): number | undefined {
  const raw = process.env["RENDER_TEMPERATURE"]?.trim();
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    notify(ctx, `RENDER_TEMPERATURE 应为 0~2 的数字，得到：${raw}，已忽略`, "warning");
    return undefined;
  }
  return value;
}

/**
 * 渲染轮可以跑在与结算轮不同的模型上：`RENDER_MODEL=provider/model-id`。
 * 未设置或找不到时回退到结算轮的当前模型。
 */
function resolveRendererModel(ctx: ExtensionContext): ExtensionContext["model"] {
  const override = process.env["RENDER_MODEL"]?.trim();
  if (override === undefined || override === "") {
    return ctx.model;
  }
  const slash = override.indexOf("/");
  if (slash <= 0 || slash === override.length - 1) {
    notify(ctx, `RENDER_MODEL 格式应为 provider/model-id，得到：${override}`, "warning");
    return ctx.model;
  }
  const model = ctx.modelRegistry.find(override.slice(0, slash), override.slice(slash + 1));
  if (model === undefined) {
    notify(ctx, `RENDER_MODEL 未命中任何已注册模型：${override}，回退结算模型`, "warning");
    return ctx.model;
  }
  return model;
}

/**
 * Digest writer 可以用独立于渲染模型的模型：`DIGEST_MODEL=provider/model-id`。
 * 未设置或找不到时回退到渲染模型的规则（即 `RENDER_MODEL` → 结算模型）。
 */
function resolveDigestModel(ctx: ExtensionContext): ExtensionContext["model"] {
  const override = process.env["DIGEST_MODEL"]?.trim();
  if (override === undefined || override === "") {
    return resolveRendererModel(ctx);
  }
  const slash = override.indexOf("/");
  if (slash <= 0 || slash === override.length - 1) {
    notify(ctx, `DIGEST_MODEL 格式应为 provider/model-id，得到：${override}`, "warning");
    return resolveRendererModel(ctx);
  }
  const model = ctx.modelRegistry.find(override.slice(0, slash), override.slice(slash + 1));
  if (model === undefined) {
    notify(ctx, `DIGEST_MODEL 未命中任何已注册模型：${override}，回退渲染模型`, "warning");
    return resolveRendererModel(ctx);
  }
  return model;
}

function setWorking(ctx: ExtensionContext, message: string | undefined): void {
  if (ctx.hasUI) {
    ctx.ui.setWorkingMessage(message);
  }
}

function readPendingPacket(
  messages: ReadonlyArray<unknown>,
  ctx: ExtensionContext,
): PendingDirectionPacket | undefined {
  try {
    return findPendingDirectionPacket(messages);
  } catch (error) {
    // packet 已过工具层验证，这里失败属于异常路径：通知并放弃渲染。
    notify(ctx, `two-pass render: invalid packet (${formatError(error)})`, "error");
    return undefined;
  }
}

/** 渲染不可用时的兜底：binding 事实以平文列出，保证玩家至少看到结算结果。 */
function buildFallbackProse(packet: RenderDirectionPacket): string {
  return [
    "（渲染器暂不可用，以下为本轮结算摘要）",
    "",
    ...packet.resolvedChanges.map((entry) => `- ${entry}`),
    "",
    `> ${packet.endWindow}`,
  ].join("\n");
}

function readSuggestedActionsFromDetails(details: Record<string, unknown>): SuggestedAction[] {
  const raw = details["suggestedActions"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const actions: SuggestedAction[] = [];
  for (const action of raw) {
    if (!isRecord(action)) {
      continue;
    }
    const submitText = action["submitText"];
    if (typeof submitText === "string") {
      actions.push({ submitText });
    }
  }
  return actions;
}

function sendProse(pi: ExtensionAPI, text: string, details: Record<string, unknown>): void {
  // Notify intercom extension of pending prose for cross-process delivery
  // oxlint-disable-next-line no-unsafe-type-assertion — globalThis interop
  (globalThis as unknown as { __intercomProseReady?: (t: string) => void }).__intercomProseReady?.(
    text,
  );
  pi.sendMessage(
    { customType: PROSE_CUSTOM_TYPE, content: text, display: true, details },
    { triggerTurn: false },
  );
}

const renderProseMessage: MessageRenderer = (message) => {
  const text = typeof message.content === "string" ? message.content : joinText(message.content);
  return new Markdown(text, 1, 0, getMarkdownTheme());
};

function joinText(content: ReadonlyArray<{ type: string }>): string {
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && "text" in part && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error"): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
