import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadFromFile, saveToFile } from "./prose-digest-store.ts";

function tempStorePath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "prose-digest-"));
  return { path: join(dir, "digests.json"), cleanup: () => rmSync(dir, { recursive: true }) };
}

void test("prose digest store round-trips entries", () => {
  const { path, cleanup } = tempStorePath();
  try {
    assert.equal(loadFromFile(path).size, 0);
    saveToFile(path, "tc-1", "  第一轮摘要\n带换行  ");
    saveToFile(path, "tc-2", "第二轮摘要");
    const digests = loadFromFile(path);
    assert.equal(digests.get("tc-1"), "第一轮摘要 带换行");
    assert.equal(digests.get("tc-2"), "第二轮摘要");
  } finally {
    cleanup();
  }
});

void test("prose digest store ignores empty writes and corrupt files", () => {
  const { path, cleanup } = tempStorePath();
  try {
    saveToFile(path, "", "摘要");
    saveToFile(path, "tc-1", "   ");
    assert.equal(loadFromFile(path).size, 0);
    writeFileSync(path, "{not json", "utf-8");
    assert.equal(loadFromFile(path).size, 0);
    saveToFile(path, "tc-1", "重建后的摘要");
    assert.equal(loadFromFile(path).get("tc-1"), "重建后的摘要");
  } finally {
    cleanup();
  }
});

void test("prose digest store evicts oldest entries beyond the cap", () => {
  const { path, cleanup } = tempStorePath();
  try {
    for (let index = 1; index <= 502; index++) {
      saveToFile(path, `tc-${index}`, `摘要 ${index}`);
    }
    const digests = loadFromFile(path);
    assert.equal(digests.size, 500);
    assert.equal(digests.get("tc-1"), undefined);
    assert.equal(digests.get("tc-2"), undefined);
    assert.equal(digests.get("tc-502"), "摘要 502");
  } finally {
    cleanup();
  }
});
