import { CURRENT_STATE_SCHEMA_VERSION } from "./state.ts";
import { assertInteger, formatUnknown, isRecord } from "../utils/typebox-validation.ts";

/**
 * Persisted state schema migration —— 项目宪章里唯一允许的兼容层。
 * 迁移链必须线性：每个函数只负责相邻版本 v_n -> v_{n+1}，禁止 O(n²) 迁移矩阵。
 * 这里只处理裸 record 形态；schema 校验由 parseStateSchema 在迁移之后负责。
 */
export function migrateRawGameState(raw: Record<string, unknown>): Record<string, unknown> {
  let current = structuredClone(raw);
  while (true) {
    const version = readRawSchemaVersion(current);
    if (version === CURRENT_STATE_SCHEMA_VERSION) {
      return current;
    }
    current = migrateOneSchemaVersion(current, version);
  }
}

function migrateOneSchemaVersion(
  raw: Record<string, unknown>,
  version: number,
): Record<string, unknown> {
  switch (version) {
    case 0:
      return migrateGameStateV0ToV1(raw);
    case 1:
      return migrateGameStateV1ToV2(raw);
    default:
      throw new Error(
        `不支持的 state schemaVersion: ${version}。当前支持逐步迁移到 ${CURRENT_STATE_SCHEMA_VERSION}。`,
      );
  }
}

function readRawSchemaVersion(raw: Record<string, unknown>): number {
  const meta = raw["meta"];
  if (!isRecord(meta)) {
    throw new Error(`state migration: meta 格式异常: ${formatUnknown(meta)}`);
  }
  return assertInteger(meta["schemaVersion"], "meta.schemaVersion");
}

// v0→v1: 添加 pendingDirectionPacket 字段（引擎内部结算标记）
function migrateGameStateV0ToV1(raw: Record<string, unknown>): Record<string, unknown> {
  const pub = raw["public"];
  if (!isRecord(pub)) {
    throw new Error(`state migration: public 格式异常: ${formatUnknown(pub)}`);
  }
  const meta = raw["meta"];
  if (!isRecord(meta)) {
    throw new Error(`state migration: meta 格式异常: ${formatUnknown(meta)}`);
  }
  return {
    ...raw,
    public: {
      ...pub,
      pendingDirectionPacket: pub["pendingDirectionPacket"] ?? false,
    },
    meta: {
      ...meta,
      schemaVersion: 1,
    },
  };
}

// v1→v2: offscreenEventLog 移除，factionClocks → undercurrents（字段结构调整）
function migrateGameStateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const secrets = raw["secrets"];
  if (!isRecord(secrets)) {
    throw new Error(`state migration: secrets 格式异常: ${formatUnknown(secrets)}`);
  }
  const meta = raw["meta"];
  if (!isRecord(meta)) {
    throw new Error(`state migration: meta 格式异常: ${formatUnknown(meta)}`);
  }

  // 删除 offscreenEventLog
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { offscreenEventLog: _removed, factionClocks: oldClocks, ...restSecrets } = secrets;

  // 转换 factionClocks → undercurrents
  const oldClockArray = Array.isArray(oldClocks) ? oldClocks : [];
  const undercurrents = oldClockArray.map((clock: Record<string, unknown>) => ({
    id: clock["id"] ?? "",
    actorIds: clock["factionId"] ? [String(clock["factionId"])] : [],
    label: clock["label"] ?? "",
    filled: typeof clock["filled"] === "number" ? clock["filled"] : 0,
    size: typeof clock["size"] === "number" ? clock["size"] : 4,
    visibility: clock["visibility"] === "leaked" ? "foreshadowed" : "secret",
    pressureType: "",
    futureHook: "",
    lastChangedAt: "",
  }));

  return {
    ...raw,
    secrets: {
      ...restSecrets,
      undercurrents,
    },
    meta: {
      ...meta,
      schemaVersion: 2,
    },
  };
}