import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isRecord } from "../core/utils/typebox-validation.ts";

/**
 * Writer 化散文摘要缓存（backlog #13，MiMo checkpoint-writer 思路）。
 *
 * 按 sessionId 分文件存储（state/prose-digests/{sessionId}.json），
 * 不同会话的摘要完全隔离。
 *
 * 渲染摘要层默认从 direction packet 机械提取（零 LLM、rewind 安全）。
 * 本 store 缓存独立 writer 产出的更高质量单行摘要（事件 + 关系/态度变化），
 * 按 submit_direction_packet 的 toolCallId 索引：
 * - rewind/分叉后查不到的轮次自动回退机械摘要，永不阻塞渲染；
 * - single-writer 不变量：只有渲染扩展的 digest writer 调 saveProseDigest，
 *   渲染装配只读。
 */

const DIGEST_DIR = "state/prose-digests";
const OLD_FILE_PATH = "state/prose-digests.json";
const LEGACY_FILE_PATH = `${DIGEST_DIR}/_legacy.json`;
/** 条目上限；超出时按插入顺序淘汰最旧（旧轮次早已滑出摘要窗口）。 */
const MAX_ENTRIES = 500;

function digestFilePath(sessionId: string): string {
  return `${DIGEST_DIR}/${sessionId}.json`;
}

/**
 * 加载指定 session 的摘要缓存。
 *
 * 加载链：per-session 文件 → _legacy.json（第一次迁移副本）→ 旧 prose-digests.json → 空。
 * 首次从旧文件加载时，会将全部内容引导到该 session 的独立文件作为起点，
 * 之后所有新摘要只写入 per-session 文件，实现隔离。
 */
export function loadProseDigests(sessionId: string): Map<string, string> {
  const path = digestFilePath(sessionId);
  if (existsSync(path)) {
    return loadFromFile(path);
  }
  // Fallback: legacy（已迁移的旧文件副本）或原始旧文件
  const srcPath = existsSync(LEGACY_FILE_PATH)
    ? LEGACY_FILE_PATH
    : existsSync(OLD_FILE_PATH)
      ? OLD_FILE_PATH
      : undefined;
  if (srcPath === undefined) {
    return new Map();
  }
  // 首次加载：把旧文件/legacy 全部内容引导到 per-session 文件作为起点，
  // 之后所有写入走 isolation 路径。
  const digests = loadFromFile(srcPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ version: 1, digests: Object.fromEntries(digests) }, null, 2)}\n`,
    "utf-8",
  );
  return digests;
}

export function saveProseDigest(sessionId: string, toolCallId: string, digest: string): void {
  saveToFile(digestFilePath(sessionId), toolCallId, digest);
}

/**
 * 一次性迁移：把旧 `state/prose-digests.json` copy 到
 * `state/prose-digests/_legacy.json` 并将原文件重命名为 `.bak`。
 * 幂等（已存在 legacy 文件时跳过）。
 */
export function migrateOldProseDigestFile(): boolean {
  if (!existsSync(OLD_FILE_PATH)) {
    return false;
  }
  if (existsSync(LEGACY_FILE_PATH)) {
    return false;
  }
  mkdirSync(DIGEST_DIR, { recursive: true });
  copyFileSync(OLD_FILE_PATH, LEGACY_FILE_PATH);
  renameSync(OLD_FILE_PATH, `${OLD_FILE_PATH}.bak`);
  return true;
}

/** 测试/基准工具：从指定路径加载（绕过 sessionId 路径推导）。 */
export function loadFromFile(path: string): Map<string, string> {
  if (!existsSync(path)) {
    return new Map();
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(raw) || raw["version"] !== 1 || !isRecord(raw["digests"])) {
      return new Map();
    }
    const digests = new Map<string, string>();
    for (const [key, value] of Object.entries(raw["digests"])) {
      if (typeof value === "string" && value.trim().length > 0) {
        digests.set(key, value.trim());
      }
    }
    return digests;
  } catch {
    return new Map();
  }
}

/** 测试/基准工具：写入指定路径（绕过 sessionId 路径推导）。 */
export function saveToFile(path: string, toolCallId: string, digest: string): void {
  const trimmed = digest.trim().replaceAll("\n", " ");
  if (toolCallId.length === 0 || trimmed.length === 0) {
    return;
  }
  const digests = loadFromFile(path);
  digests.delete(toolCallId);
  digests.set(toolCallId, trimmed);
  while (digests.size > MAX_ENTRIES) {
    const oldest = digests.keys().next().value;
    if (oldest === undefined) break;
    digests.delete(oldest);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ version: 1, digests: Object.fromEntries(digests) }, null, 2)}\n`,
    "utf-8",
  );
}
