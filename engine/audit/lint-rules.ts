import { existsSync, readFileSync } from "node:fs";

/**
 * 叙事输出契约 / style blacklist 的机械可检测子集（纯函数规则集）。
 *
 * 单一事实来源：`agents/gm-output-contract.md` 与 `agents/gm-style-blacklist.md`。
 * 这里只收录可正则化的禁令；语义类禁令（作者总结、抽象名词定义等）不在此层。
 *
 * 消费方：
 * - `engine/audit/session-audit.ts`（JSONL 回归审计，backlog #8）
 * - 未来 output-lint extension（backlog #1）
 */

export type LintSeverity = "warn" | "block";

export interface LintFinding {
  ruleId: string;
  severity: LintSeverity;
  /** 命中的原文片段 */
  match: string;
  /** 命中处前后文摘录，便于人工定位 */
  excerpt: string;
}

type RuleScope = "opening" | "ending" | "anywhere" | "per-line";
export type ProseLengthTier = "light" | "normal" | "heavy";

export interface ProseLengthContext {
  eventWeight: ProseLengthTier;
  resolvedChangeCount: number;
  npcStanceCount: number;
}

interface LocalProseRule {
  id: string;
  scope: RuleScope;
  pattern: string;
}

interface ProseRule {
  id: string;
  scope: RuleScope;
  /** 必须带 g flag；每次匹配前 lastIndex 会被重置 */
  pattern: RegExp;
}

/** ending scope 检查的结尾窗口长度（字符） */
const ENDING_WINDOW_CHARS = 160;
const EXCERPT_RADIUS = 24;

const LOCAL_PROSE_LINT_PATH = "agents/user/prose-lint.json";

interface ProseLengthPolicy {
  base: number;
  perResolvedChange: number;
  perNpcStance: number;
  maximum: number;
}

const PROSE_LENGTH_POLICIES: Record<ProseLengthTier, ProseLengthPolicy> = {
  light: { base: 120, perResolvedChange: 20, perNpcStance: 20, maximum: 220 },
  normal: { base: 260, perResolvedChange: 35, perNpcStance: 30, maximum: 520 },
  heavy: { base: 520, perResolvedChange: 45, perNpcStance: 35, maximum: 900 },
};

const PROSE_RULES: readonly ProseRule[] = [
  {
    id: "opening-delivery-wrapper",
    scope: "opening",
    pattern: /^[「『"'（(]?(?:好的|好。|好，|以下是|那么|状态已经|现在为你写)/g,
  },
  {
    id: "pseudo-menu-ending",
    scope: "ending",
    pattern:
      /你可以[^。！？\n]{0,50}(?:也可以|或者)|左边是[^。！？\n]{0,50}右边是|是[^。！？\n，]{1,30}还是[^。！？\n]{1,30}[？?]/g,
  },
  {
    // 伪菜单套台词壳：「A，或者B，由你定」——枚举选项+把决定权句式化
    // 地交还玩家。台词内外都禁：这是系统发选项，不是角色在说话。
    id: "pseudo-menu-in-dialogue",
    scope: "ending",
    pattern:
      /[^。！？\n]{1,24}，或者[^。！？\n]{1,24}，(?:都)?(?:由|看|听)?你(?:来)?(?:定|决定|选|拿主意)/g,
  },
  { id: "markdown-divider", scope: "per-line", pattern: /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/g },
  { id: "markdown-heading", scope: "per-line", pattern: /^#{1,6}\s/g },
  {
    id: "machine-artifact",
    scope: "per-line",
    pattern: /^\s*[{}]\s*,?\s*$|^```|"[A-Za-z_][A-Za-z0-9_]*"\s*:/g,
  },
  {
    id: "negation-reversal",
    scope: "anywhere",
    pattern: /并非[^。！？\n]{0,40}而是|与其说/g,
  },
  {
    // 口语变体：旁白中的「不是A，(而)是B」与句号断开的「不是A。是B」抬升句式
    //（后者是逗号版被堵后模型的绕逃路径，如「不是商量。是判断。」）。
    // 仅匹配不含对话引号的行，避免误伤角色台词里正常的纠正句；
    // 句号变体要求 B 侧也是短句，压低对普通叙述接句的误伤。
    id: "negation-reversal-colloquial",
    scope: "per-line",
    pattern:
      /^(?!.*[「『"])[^\n]*?不是[^。！？，,\n]{1,20}(?:[，,]\s*而?是|。\s*是[^。！？\n]{1,12}。)/g,
  },
  {
    // 否定排比抬升（stop-slop: negative listing）：「不是X。不是Y。是Z。」
    // 逗号分隔变体已由 negation-reversal-colloquial 覆盖；这里攐句号/分号版。
    id: "negative-listing",
    scope: "per-line",
    pattern:
      /^(?!.*[「『"])[^\n]*?不是[^。！？\n]{1,16}[。；;][^\n]{0,30}?不是[^。！？\n]{1,16}[。；;]\s*[而只]?是/g,
  },
  {
    // 伪转变弧（stop-slop: false transformation arc）：「不再是A，而是B」。
    id: "false-transformation",
    scope: "per-line",
    pattern: /^(?!.*[「『"])[^\n]*?不再是[^。！？，,\n]{1,20}[，,。]\s*而?是/g,
  },
  {
    id: "empty-atmosphere",
    scope: "anywhere",
    pattern: /空气中弥漫|显得格外|某种说不出的|难以言喻/g,
  },
  {
    id: "perception-report",
    scope: "anywhere",
    pattern: /[你他她](?:看到|听到|闻到|感觉到)/g,
  },
  {
    id: "empty-motion-beat",
    scope: "anywhere",
    pattern: /[他她]动了|就是现在/g,
  },
  {
    id: "water-metaphor",
    scope: "anywhere",
    pattern: /心湖|涟漪|波澜|巨浪|惊涛骇浪|溺水|浮木|坠入谷底/g,
  },
  {
    id: "fake-climax",
    scope: "anywhere",
    pattern: /第一次真正|终于明白|你意识到|你承认/g,
  },
  {
    id: "double-simile",
    scope: "anywhere",
    pattern: /像[^，。！？\n]{1,24}[，,]\s*又?(?:像|仿佛)/g,
  },
  {
    id: "report-sentence",
    scope: "anywhere",
    pattern: /目标完成|威胁提升|当前局势|可选行动如下/g,
  },
];

function makeExcerpt(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + matchLength + EXCERPT_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function loadLocalProseRules(): ProseRule[] {
  if (!existsSync(LOCAL_PROSE_LINT_PATH)) {
    return [];
  }
  const raw = parseLocalProseLintFile();
  if (!isRecord(raw) || !Array.isArray(raw["rules"])) {
    throw new Error(`${LOCAL_PROSE_LINT_PATH}: root must be { rules: [...] }`);
  }
  return raw["rules"].map(parseLocalProseRule);
}

function parseLocalProseLintFile(): unknown {
  try {
    return JSON.parse(readFileSync(LOCAL_PROSE_LINT_PATH, "utf-8"));
  } catch (error) {
    throw new Error(`${LOCAL_PROSE_LINT_PATH}: invalid JSON or unreadable file`, { cause: error });
  }
}

function parseLocalProseRule(raw: unknown, index: number): ProseRule {
  if (!isRecord(raw)) {
    throw new Error(`${LOCAL_PROSE_LINT_PATH}: rules[${index}] must be an object`);
  }
  const rule = readLocalProseRule(raw, index);
  return { id: rule.id, scope: rule.scope, pattern: compileLocalPattern(rule, index) };
}

function readLocalProseRule(raw: Record<string, unknown>, index: number): LocalProseRule {
  const id = raw["id"];
  const scope = raw["scope"];
  const pattern = raw["pattern"];
  if (typeof id !== "string" || !/^[a-z][a-z0-9_-]*$/u.test(id)) {
    throw new Error(`${LOCAL_PROSE_LINT_PATH}: rules[${index}].id must be tag-safe`);
  }
  if (typeof scope !== "string" || !isRuleScope(scope)) {
    throw new Error(`${LOCAL_PROSE_LINT_PATH}: rules[${index}].scope is unknown`);
  }
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error(`${LOCAL_PROSE_LINT_PATH}: rules[${index}].pattern must be non-empty`);
  }
  return { id, scope, pattern };
}

function compileLocalPattern(rule: LocalProseRule, index: number): RegExp {
  try {
    return new RegExp(rule.pattern, "gu");
  } catch (error) {
    throw new Error(`${LOCAL_PROSE_LINT_PATH}: rules[${index}].pattern is invalid`, {
      cause: error,
    });
  }
}

function isRuleScope(value: string): value is RuleScope {
  return value === "opening" || value === "ending" || value === "anywhere" || value === "per-line";
}

function allProseRules(): ProseRule[] {
  return [...PROSE_RULES, ...loadLocalProseRules()];
}

export function minimumProseUnits(context: ProseLengthContext): number {
  const policy = PROSE_LENGTH_POLICIES[context.eventWeight];
  const resolvedChangeCount = Math.max(0, context.resolvedChangeCount);
  const npcStanceCount = Math.max(0, context.npcStanceCount);
  return Math.min(
    policy.maximum,
    policy.base +
      resolvedChangeCount * policy.perResolvedChange +
      npcStanceCount * policy.perNpcStance,
  );
}

function countReadableUnits(prose: string): number {
  const cjk =
    prose.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      ?.length ?? 0;
  const latinWords = prose.match(/[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/gu)?.length ?? 0;
  return cjk + latinWords;
}

export function lintProseLength(prose: string, context: ProseLengthContext): LintFinding[] {
  const actual = countReadableUnits(prose);
  const minimum = minimumProseUnits(context);
  if (actual >= minimum) {
    return [];
  }
  return [
    {
      ruleId: "underlength-prose",
      severity: "warn",
      match: `${actual}/${minimum} 字`,
      excerpt: `eventWeight=${context.eventWeight}; resolvedChanges=${context.resolvedChangeCount}; npcStances=${context.npcStanceCount}`,
    },
  ];
}

export function proseLengthContextFromPacket(packet: unknown): ProseLengthContext | undefined {
  if (!isRecord(packet) || packet["needsRender"] !== true) {
    return undefined;
  }
  const eventWeight = packet["eventWeight"];
  if (!isProseLengthTier(eventWeight)) {
    return undefined;
  }
  return {
    eventWeight,
    resolvedChangeCount: Array.isArray(packet["resolvedChanges"])
      ? packet["resolvedChanges"].length
      : 0,
    npcStanceCount: Array.isArray(packet["npcStances"]) ? packet["npcStances"].length : 0,
  };
}

function isProseLengthTier(value: unknown): value is ProseLengthTier {
  return value === "light" || value === "normal" || value === "heavy";
}

function matchRule(rule: ProseRule, text: string): LintFinding[] {
  rule.pattern.lastIndex = 0;
  const findings: LintFinding[] = [];
  for (const m of text.matchAll(rule.pattern)) {
    findings.push({
      ruleId: rule.id,
      severity: "warn",
      match: m[0],
      excerpt: makeExcerpt(text, m.index, m[0].length),
    });
  }
  return findings;
}

function firstNonEmptyLine(prose: string): string {
  for (const line of prose.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

/**
 * 对最终玩家可见正文跑全部 prose 规则。
 * 不含未揭示秘密扫描——那个需要 secrets 上下文，走 findSecretLeaks。
 */
export function lintFinalProse(prose: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const opening = firstNonEmptyLine(prose);
  const ending = prose.slice(Math.max(0, prose.length - ENDING_WINDOW_CHARS));
  const lines = prose.split("\n");

  for (const rule of allProseRules()) {
    switch (rule.scope) {
      case "opening":
        findings.push(...matchRule(rule, opening));
        break;
      case "ending":
        findings.push(...matchRule(rule, ending));
        break;
      case "anywhere":
        findings.push(...matchRule(rule, prose));
        break;
      case "per-line":
        for (const line of lines) findings.push(...matchRule(rule, line));
        break;
    }
  }
  return findings;
}

/**
 * 扫描正文是否泄漏未揭示秘密字符串。
 * 命中即 block 级 finding。
 */
export function findSecretLeaks(text: string, unrevealedSecrets: readonly string[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const secret of unrevealedSecrets) {
    if (secret.length === 0) continue;
    let from = 0;
    for (;;) {
      const index = text.indexOf(secret, from);
      if (index === -1) break;
      findings.push({
        ruleId: "unrevealed-secret-leak",
        severity: "block",
        match: secret,
        excerpt: makeExcerpt(text, index, secret.length),
      });
      from = index + secret.length;
    }
  }
  return findings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUnrevealedValue(
  slot: unknown,
  pick: (value: unknown) => string | undefined,
): string | undefined {
  if (!isRecord(slot)) return undefined;
  if (slot["revealState"] === "revealed") return undefined;
  return pick(slot["value"]);
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function collectUnrevealedArrayValues(entries: unknown, out: Set<string>): void {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    const value = readUnrevealedValue(entry, pickString);
    if (value !== undefined) out.add(value);
  }
}

/**
 * 从持久化 state 的 `secrets` 域提取所有未揭示（revealState !== "revealed"）的
 * 途径秘密、序列秘密、私密动机与未公开阵营字符串。
 * 输入按 unknown 处理（来自 JSONL 快照，不可信任形状）。
 */
export function collectUnrevealedSecretStrings(secrets: unknown): string[] {
  if (!isRecord(secrets)) return [];
  const actorStates = secrets["actorStates"];
  if (!isRecord(actorStates)) return [];

  const out = new Set<string>();
  for (const bundle of Object.values(actorStates)) {
    if (!isRecord(bundle)) continue;
    const entry = bundle["secrets"];
    if (!isRecord(entry)) continue;

    const pathwayValue = readUnrevealedValue(entry["pathwaySecret"], pickString);
    if (pathwayValue !== undefined) out.add(pathwayValue);

    const sequenceValue = readUnrevealedValue(entry["sequenceSecret"], pickString);
    if (sequenceValue !== undefined) out.add(sequenceValue);
    collectUnrevealedArrayValues(entry["beyonderSecrets"], out);
    collectUnrevealedArrayValues(entry["privateMotives"], out);
    collectUnrevealedArrayValues(entry["unrevealedAffiliations"], out);
  }
  return [...out];
}
