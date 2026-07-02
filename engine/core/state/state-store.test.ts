import assert from "node:assert/strict";
import test from "node:test";

import { cloneState, commitState, getPublicState, getState, hydrateState, patchState, replaceStateForDebug, resetState } from "./state-store.ts";

void test("resetState creates a valid initial state", () => {
  const state = resetState();

  assert.equal(state.meta.schemaVersion, 2);
  assert.equal(state.public.protagonistActorId, "protagonist");
  assert.equal(typeof state.meta.rngSeed, "number");
});

void test("getState returns a clone, not the same reference", () => {
  resetState();
  const a = getState();
  const b = getState();

  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});

void test("cloneState is equivalent to getState", () => {
  resetState();
  const a = getState();
  const b = cloneState();

  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});

void test("getPublicState returns only the public portion", () => {
  resetState();
  const pub = getPublicState();

  assert.ok(pub.scenario);
  assert.ok(pub.clock);
  assert.ok(pub.actors);
  // @ts-expect-error secrets is on the private half
  assert.equal(pub.secrets, undefined);
});

void test("patchState with non-empty ops throws", () => {
  resetState();

  assert.throws(
    () => patchState([{ op: "replace", path: "/money", value: 999 }]),
    /patch_state 已降级/,
  );
});

void test("patchState with empty ops returns clone", () => {
  resetState();
  const result = patchState([]);

  assert.equal(result.public.protagonistActorId, "protagonist");
});

void test("replaceStateForDebug validates and replaces state in place", () => {
  resetState();
  const fresh = resetState();
  fresh.public.scenario.title = "替换后的标题";

  const result = replaceStateForDebug(fresh);

  assert.equal(result.public.scenario.title, "替换后的标题");
  // Store should be updated
  const fromStore = getState();
  assert.equal(fromStore.public.scenario.title, "替换后的标题");
});

void test("replaceStateForDebug rejects invalid state", () => {
  resetState();

  assert.throws(
    () => replaceStateForDebug({ invalid: true } as never),
    /非法.?状态|state migration/,
  );
});

void test("commitState validates and commits state, updating meta.updatedAt", () => {
  resetState();
  const fresh = resetState();
  fresh.public.scenario.title = "提交后的标题";

  const result = commitState(fresh);

  assert.equal(result.public.scenario.title, "提交后的标题");
  // meta.updatedAt should be updated to now
  assert.ok(Date.parse(result.meta.updatedAt) > Date.parse("2000-01-01"));
  // Store should be updated
  const fromStore = getState();
  assert.equal(fromStore.public.scenario.title, "提交后的标题");
});
void test("commitState rejects invalid state", () => {
  resetState();

  assert.throws(
    () => commitState({ invalid: true } as never),
    /非法.?状态|state migration/,
  );
});

void test("hydrateState sets state from raw object", () => {
  resetState();
  const fresh = resetState();
  fresh.public.scenario.title = "恢复后的标题";

  hydrateState(fresh);

  const fromStore = getState();
  assert.equal(fromStore.public.scenario.title, "恢复后的标题");
});

void test("hydrateState accepts { state } wrapper", () => {
  resetState();
  const fresh = resetState();
  fresh.public.scenario.title = "包装后的标题";

  hydrateState({ state: fresh });

  const fromStore = getState();
  assert.equal(fromStore.public.scenario.title, "包装后的标题");
});

void test("hydrateState rejects invalid data", () => {
  resetState();
  assert.throws(
    () => hydrateState({ invalid: true }),
    /非法.?状态|state migration/,
  );
});