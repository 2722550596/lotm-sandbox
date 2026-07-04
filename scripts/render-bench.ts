/**
 * 渲染器多模型横评（backlog：SOTA 区分度测量）。
 *
 * 从 session JSONL 取已渲染的历史轮，复刻生产渲染输入（system prompt +
 * 分层散文史 + direction packet），对每个候选模型渲染 N 轮，落盘：
 *
 *   docs/render-bench/<ts>/turn-<n>/
 *     baseline.md                  当时实际交付的正文
 *     <provider>__<model>/round-<i>.md   含 frontmatter（用量/耗时/lint）
 *     blind/sample-XX.md           匿名乱序副本（盲评用）
 *     blind/key.json               揭盲映射
 *   docs/render-bench/<ts>/index.md    汇总表
 *
 * 用法：
 *   node scripts/render-bench.ts [--session path] [--turns 1] [--rounds 3]
 *     [--models p/m,p/m,...] [--reasoning minimal] [--dry-run]
 *
 * --turns K：取最近 K 个已渲染轮各测一遍。--dry-run 只验证模型解析与输入装配。
 */

import type { Api, Message, Model, ThinkingLevel } from "@earendil-works/pi-ai";

import { streamSimple } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { lintFinalProse } from "../engine/audit/lint-rules.ts";
import { parseSessionJsonl, reconstructActivePath } from "../engine/audit/session-audit.ts";
import { loadFromFile } from "../engine/direction/prose-digest-store.ts";
import {
  buildRendererMessages,
  findPendingDirectionPacket,
  PROSE_CUSTOM_TYPE,
  type RendererMessage,
} from "../engine/direction/render-turn.ts";
import { buildRendererSystemPrompt } from "../engine/gm-prompt/injection.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const DEFAULT_MODELS = [
  "deepseek/deepseek-v4-pro",
  "anthropic/claude-opus-4-5",
  "anthropic/claude-fable-5",
  "openai-codex/gpt-5.5",
  "pollux-gemini/gemini-3.1-pro-preview",
];
const RENDERER_MAX_TOKENS = 8192;

interface CliOptions {
  session: string;
  turns: number;
  rounds: number;
  models: string[];
  reasoning: ThinkingLevel;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    session: newestSessionFile(),
    turns: 1,
    rounds: 3,
    models: DEFAULT_MODELS,
    reasoning: "minimal",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--session") options.session = expectValue(argv, ++i, arg);
    else if (arg === "--turns") options.turns = Number(expectValue(argv, ++i, arg));
    else if (arg === "--rounds") options.rounds = Number(expectValue(argv, ++i, arg));
    else if (arg === "--models") options.models = expectValue(argv, ++i, arg).split(",");
    else if (arg === "--reasoning")
      options.reasoning = parseThinkingLevel(expectValue(argv, ++i, arg));
    else throw new Error(`render-bench: unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.turns) || options.turns < 1) {
    throw new Error("render-bench: --turns must be a positive integer");
  }
  if (!Number.isInteger(options.rounds) || options.rounds < 1) {
    throw new Error("render-bench: --rounds must be a positive integer");
  }
  return options;
}

const THINKING_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];

function parseThinkingLevel(raw: string): ThinkingLevel {
  const level = THINKING_LEVELS.find((candidate) => candidate === raw);
  if (level === undefined) {
    throw new Error(`render-bench: --reasoning must be one of ${THINKING_LEVELS.join("|")}`);
  }
  return level;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`render-bench: ${flag} requires a value`);
  return value;
}

function newestSessionFile(): string {
  const dir = join(PROJECT_ROOT, "sessions");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .toSorted();
  const newest = files.at(-1);
  if (newest === undefined) throw new Error("render-bench: no session .jsonl found");
  return join(dir, newest);
}

// ---------- session → 渲染输入复刻 ----------

interface BenchTurn {
  /** 该轮在 active path 上的 prose 序号（1-based，与渲染史的轮号一致） */
  turn: number;
  baseline: string;
  systemPrompt: string;
  messages: RendererMessage[];
}

/** RawEntry 流 → buildRendererMessages 期待的消息流形状。 */
function entryToMessage(entry: {
  type: string;
  message?: Record<string, unknown>;
  customType?: string;
  content?: unknown;
}): unknown {
  if (entry.type === "message" && entry.message !== undefined) return entry.message;
  if (entry.type === "custom_message" && entry.customType === PROSE_CUSTOM_TYPE) {
    return { role: "custom", customType: PROSE_CUSTOM_TYPE, content: entry.content };
  }
  return undefined;
}

function collectBenchTurns(sessionPath: string, wanted: number): BenchTurn[] {
  const entries = reconstructActivePath(parseSessionJsonl(readFileSync(sessionPath, "utf-8")));
  const messages: unknown[] = [];
  for (const entry of entries) {
    const message = entryToMessage(entry);
    if (message !== undefined) messages.push(message);
  }

  const proseIndices: number[] = [];
  messages.forEach((message, index) => {
    if (isRecord(message) && message["customType"] === PROSE_CUSTOM_TYPE) {
      proseIndices.push(index);
    }
  });

  const systemPrompt = buildRendererSystemPrompt();
  const digests = loadFromFile(join(PROJECT_ROOT, "state", "prose-digests.json"));
  const turns: BenchTurn[] = [];
  for (const [ordinal, proseIndex] of proseIndices.entries()) {
    if (ordinal < proseIndices.length - wanted) continue;
    const prefix = messages.slice(0, proseIndex);
    const pending = findPendingDirectionPacket(prefix);
    if (pending === undefined || !pending.packet.needsRender) continue;
    const proseMessage = messages[proseIndex];
    const baseline = isRecord(proseMessage) ? proseMessage["content"] : undefined;
    turns.push({
      turn: ordinal + 1,
      baseline: typeof baseline === "string" ? baseline : "",
      systemPrompt,
      messages: buildRendererMessages(prefix, pending.packet, digests),
    });
  }
  if (turns.length === 0) {
    throw new Error("render-bench: no renderable turns found in session active path");
  }
  return turns;
}

// ---------- 渲染 ----------

interface RoundResult {
  model: string;
  round: number;
  prose: string;
  chars: number;
  ms: number;
  lintRuleIds: string[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  error?: string;
}

function toStreamMessages(messages: readonly RendererMessage[], model: Model<Api>): Message[] {
  return messages.map((message): Message => {
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
  });
}

async function renderRound(
  registry: ModelRegistry,
  modelRef: string,
  turn: BenchTurn,
  round: number,
  reasoning: ThinkingLevel,
): Promise<RoundResult> {
  const base: RoundResult = {
    model: modelRef,
    round,
    prose: "",
    chars: 0,
    ms: 0,
    lintRuleIds: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
  try {
    const model = resolveModel(registry, modelRef);
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(`auth unavailable: ${auth.error}`);
    const started = Date.now();
    const result = await streamSimple(
      model,
      { systemPrompt: turn.systemPrompt, messages: toStreamMessages(turn.messages, model) },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: RENDERER_MAX_TOKENS,
        reasoning: model.reasoning ? reasoning : undefined,
      },
    ).result();
    base.ms = Date.now() - started;
    if (result.stopReason === "error" || result.stopReason === "aborted") {
      throw new Error(result.errorMessage ?? `stopReason=${result.stopReason}`);
    }
    base.prose = result.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    base.chars = base.prose.length;
    base.lintRuleIds = lintFinalProse(base.prose).map((finding) => finding.ruleId);
    base.usage = {
      input: result.usage.input,
      output: result.usage.output,
      cacheRead: result.usage.cacheRead,
      cacheWrite: result.usage.cacheWrite,
      total: result.usage.totalTokens,
    };
    base.cost = result.usage.cost.total;
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
  }
  return base;
}

function resolveModel(registry: ModelRegistry, ref: string): Model<Api> {
  const slash = ref.indexOf("/");
  if (slash <= 0) throw new Error(`model ref must be provider/model-id: ${ref}`);
  const model = registry.find(ref.slice(0, slash), ref.slice(slash + 1));
  if (model === undefined) throw new Error(`model not found in registry: ${ref}`);
  return model;
}

// ---------- 落盘 ----------

function sanitize(ref: string): string {
  return ref.replaceAll("/", "__").replaceAll(/[^A-Za-z0-9_.-]/gu, "-");
}

function roundFrontmatter(result: RoundResult): string {
  return [
    "---",
    `model: ${result.model}`,
    `round: ${result.round}`,
    `chars: ${result.chars}`,
    `ms: ${result.ms}`,
    `lint: ${result.lintRuleIds.length === 0 ? "clean" : result.lintRuleIds.join(", ")}`,
    `usage: in ${result.usage.input} / out ${result.usage.output} / cacheR ${result.usage.cacheRead} / cacheW ${result.usage.cacheWrite} / total ${result.usage.total}`,
    `cost: $${result.cost.toFixed(6)}`,
    ...(result.error !== undefined ? [`error: ${result.error}`] : []),
    "---",
    "",
  ].join("\n");
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const left = result[i];
    const right = result[j];
    if (left === undefined || right === undefined) continue;
    result[i] = right;
    result[j] = left;
  }
  return result;
}

function writeTurnOutputs(turnDir: string, turn: BenchTurn, results: RoundResult[]): void {
  mkdirSync(turnDir, { recursive: true });
  writeFileSync(join(turnDir, "baseline.md"), turn.baseline + "\n", "utf-8");

  for (const result of results) {
    const dir = join(turnDir, sanitize(result.model));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `round-${result.round}.md`),
      roundFrontmatter(result) + result.prose + "\n",
      "utf-8",
    );
  }

  // 盲评副本：去掉所有可识别元数据，乱序编号
  const blindDir = join(turnDir, "blind");
  mkdirSync(blindDir, { recursive: true });
  const ok = results.filter((result) => result.error === undefined);
  const key: Record<string, string> = {};
  shuffle(ok).forEach((result, index) => {
    const name = `sample-${String(index + 1).padStart(2, "0")}.md`;
    key[name] = `${result.model} round-${result.round}`;
    writeFileSync(join(blindDir, name), result.prose + "\n", "utf-8");
  });
  writeFileSync(join(blindDir, "key.json"), `${JSON.stringify(key, null, 2)}\n`, "utf-8");
}

function summaryTable(turn: BenchTurn, results: RoundResult[]): string {
  const lines = [
    `## turn ${turn.turn}（baseline ${turn.baseline.length} 字）`,
    "",
    "| model | round | 字数 | lint | 耗时 | tokens(out/total) | cost |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const result of results) {
    lines.push(
      result.error !== undefined
        ? `| ${result.model} | ${result.round} | — | — | — | — | ERROR: ${result.error} |`
        : `| ${result.model} | ${result.round} | ${result.chars} | ${
            result.lintRuleIds.length === 0 ? "clean" : result.lintRuleIds.join(", ")
          } | ${(result.ms / 1000).toFixed(1)}s | ${result.usage.output}/${result.usage.total} | $${result.cost.toFixed(4)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------- main ----------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const registry = ModelRegistry.create(AuthStorage.create());
  const turns = collectBenchTurns(options.session, options.turns);

  console.log(`session: ${options.session}`);
  console.log(`turns: ${turns.map((turn) => turn.turn).join(", ")} · rounds: ${options.rounds}`);
  for (const ref of options.models) {
    try {
      const model = resolveModel(registry, ref);
      const auth = await registry.getApiKeyAndHeaders(model);
      console.log(`model ${ref}: ${auth.ok ? "ok" : `AUTH FAIL (${auth.error})`}`);
    } catch (error) {
      console.log(
        `model ${ref}: NOT FOUND (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  if (options.dryRun) {
    const sample = turns[0];
    if (sample !== undefined) {
      const inputChars = sample.messages.reduce((sum, message) => sum + message.text.length, 0);
      console.log(
        `dry-run: turn ${sample.turn} renderer input = ${sample.messages.length} messages / ${inputChars} chars / system ${sample.systemPrompt.length} chars`,
      );
    }
    return;
  }

  const benchDir = join(
    PROJECT_ROOT,
    "docs",
    "render-bench",
    new Date().toISOString().replaceAll(/[:.]/gu, "-"),
  );
  const indexSections: string[] = [
    `# Render bench · ${new Date().toISOString()}`,
    "",
    `- session: ${options.session}`,
    `- models: ${options.models.join(", ")}`,
    `- rounds: ${options.rounds} · reasoning: ${options.reasoning}`,
    "",
  ];

  for (const turn of turns) {
    console.log(`\n=== turn ${turn.turn} ===`);
    // 跨模型并行、模型内串行：避免单 provider 突发限流
    const perModel = await Promise.all(
      options.models.map(async (ref) => {
        const results: RoundResult[] = [];
        for (let round = 1; round <= options.rounds; round++) {
          const result = await renderRound(registry, ref, turn, round, options.reasoning);
          console.log(
            result.error !== undefined
              ? `  ${ref} r${round}: ERROR ${result.error}`
              : `  ${ref} r${round}: ${result.chars} 字 / ${(result.ms / 1000).toFixed(1)}s / lint ${result.lintRuleIds.length === 0 ? "clean" : result.lintRuleIds.join(",")}`,
          );
          results.push(result);
        }
        return results;
      }),
    );
    const results = perModel.flat();
    writeTurnOutputs(join(benchDir, `turn-${turn.turn}`), turn, results);
    indexSections.push(summaryTable(turn, results));
  }

  writeFileSync(join(benchDir, "index.md"), indexSections.join("\n"), "utf-8");
  console.log(`\n输出目录：${benchDir}`);
  console.log("盲评：先看各 turn 的 blind/sample-*.md，评完再开 key.json 揭盲。");
}

await main();
