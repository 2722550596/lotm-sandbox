import type { CustomMessageEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

import assert from "node:assert/strict";
import test from "node:test";

import { buildChoiceWidgetLines, findLatestChoiceSet, parseChoiceCommand } from "./index.ts";

function proseEntry(
  id: string,
  parentId: string | null,
  details: Record<string, unknown>,
): CustomMessageEntry {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    customType: "rendered-prose",
    content: "正文",
    display: true,
    details,
  };
}

function messageEntry(id: string, parentId: string | null): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: "下一步", timestamp: Date.now() },
  };
}

void test("parseChoiceCommand parses submit and show commands", () => {
  assert.deepEqual(parseChoiceCommand(""), { kind: "show" });
  assert.deepEqual(parseChoiceCommand("2"), { kind: "submit", index: 1 });
  assert.equal(parseChoiceCommand("abc"), undefined);
});

void test("buildChoiceWidgetLines renders numbered full command text", () => {
  assert.deepEqual(
    buildChoiceWidgetLines([{ submitText: "追上去。" }, { submitText: "检查现场。" }]),
    ["── 可选行动（可忽略，直接手打也可以）──", "/choice 1  追上去。", "/choice 2  检查现场。"],
  );
});

void test("findLatestChoiceSet reads actions from the leaf prose", () => {
  const branch = [
    messageEntry("m0", "root"),
    proseEntry("p1", "m0", { kind: "rendered", suggestedActions: [{ submitText: "追上去。" }] }),
  ];
  const set = findLatestChoiceSet(branch);
  assert.deepEqual(set?.actions, [{ submitText: "追上去。" }]);
});

void test("findLatestChoiceSet reads actions from a rerolled prose entry", () => {
  // 回归：/reroll-narrative 落盘的 details 必须保留 suggestedActions，否则 widget 显示候选
  // 而选择报「无可用候选」。
  const branch = [
    messageEntry("m0", "root"),
    proseEntry("p1", "m0", {
      kind: "rerolled",
      replacedEntryId: "old",
      toolCallId: "t1",
      lintRuleIds: [],
      suggestedActions: [{ submitText: "检查祭坛。" }, { submitText: "先撤。" }],
    }),
  ];
  const set = findLatestChoiceSet(branch);
  assert.deepEqual(set?.actions, [{ submitText: "检查祭坛。" }, { submitText: "先撤。" }]);
});

void test("findLatestChoiceSet returns undefined when a newer message follows the prose", () => {
  const branch = [
    proseEntry("p1", "root", { suggestedActions: [{ submitText: "追上去。" }] }),
    messageEntry("m1", "p1"),
  ];
  assert.equal(findLatestChoiceSet(branch), undefined);
});

void test("findLatestChoiceSet returns undefined when the leaf prose has no actions", () => {
  const branch = [proseEntry("p1", "root", { kind: "rendered" })];
  assert.equal(findLatestChoiceSet(branch), undefined);
});
