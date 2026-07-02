import type { DomainToolDefinition } from "../runtime/tool-definition.ts";

import { Type } from "typebox";

import { CURRENT_STATE_SCHEMA_VERSION } from "../../core/state/state.ts";
import { textResult, type ToolResult } from "../runtime/tool-result.ts";

export function getStateSchemaTool(): ToolResult {
  const schema = {
    version: CURRENT_STATE_SCHEMA_VERSION,
    root: "GameState { meta, public, secrets }",
    publicAggregates: [
      "scenario",
      "clock",
      "scene",
      "actors",
      "trackedItems",
      "economy",
      "memory",
      "turnLog",
    ],
    secretBoundary: "普通工具只读写 public；secrets 仅供 private/reveal/debug 路径使用。",
    regularTools: [
      "get_status",
      "commit_turn",
      "record_memory",
      "upsert_actor",
      "update_actor_condition",
      "update_economy",
      "reveal_secret",
      "private_resolve",
    ],
    debugOnly: ["get_state_schema", "override_locked_fact", "patch_state", "reset_state"],
    forbidden: "常规玩法禁止 raw JSON Patch；必须使用领域事件工具。",
  };
  return textResult(JSON.stringify(schema, null, 2));
}

export const getStateSchemaToolDefinition: DomainToolDefinition = {
  name: "get_state_schema",
  description: "【调试工具】查看当前状态 schema 版本与聚合根。",
  parameters: Type.Object({}),
  execute: async () => getStateSchemaTool(),
};
