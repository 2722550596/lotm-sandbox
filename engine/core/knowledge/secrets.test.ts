import type { HumanActorState, PublicActorState } from "../state/state.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState, PROTAGONIST_ACTOR_ID } from "../init/initial-state.ts";
import { configureSecret, privateResolve, revealSecret } from "./secrets.ts";

function setupActorSequence(draft: ReturnType<typeof createInitialState>): void {
  // oxlint-disable-next-line no-unsafe-type-assertion
  const actor = draft.public.actors[PROTAGONIST_ACTOR_ID] as { kind: string; sequence: unknown };
  actor.kind = "beyonder";
  actor.sequence = {
    currentSequence: "观众途径-序列9",
    rank: "seq-9",
    pathway: "seer",
    promotionSystem: "potion",
    tags: [],
    actingCues: [],
  };
}

function addAllyToState(draft: ReturnType<typeof createInitialState>, id: string): void {
  const ally: HumanActorState = {
    id,
    kind: "human",
    sequence: null,
    identity: { publicIdentity: "盟友", background: "", lockedFacts: [], roles: [] },
    presentation: {
      canonicalName: "盟友",
      renderName: "盟友",
      apparentAge: "成年",
      outfit: { label: "", details: "" },
      demeanor: "",
    },
    condition: { afflictions: [] },
    inventory: { items: [] },
    abilities: [],
    relationshipToProtagonist: { stance: "neutral", summary: "" },
  };
  // oxlint-disable-next-line no-unsafe-type-assertion
  draft.public.actors[id] = ally as unknown as PublicActorState;
}

// ===========================================================================
// configureSecret — actor-beyonder
// ===========================================================================

void test("configureSecret actor-beyonder configures secrets for valid actor", () => {
  const draft = createInitialState();
  setupActorSequence(draft);

  const result = configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "初始化角色秘密",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "我可以占卜未来", revealCondition: "占卜、预言" }],
  });

  assert.match(result.message, /非凡者秘密已配置/);
  const slot = draft.secrets.actorStates[PROTAGONIST_ACTOR_ID]?.secrets?.beyonderSecrets[0];
  assert.ok(slot);
  assert.equal(slot?.value, "我可以占卜未来");
});

void test("configureSecret actor-beyonder configures multiple secrets", () => {
  const draft = createInitialState();
  setupActorSequence(draft);

  configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "初始化",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [
      { value: "我可以占卜未来", revealCondition: "占卜、预言" },
      { value: "我知道源质的本质", revealCondition: "源质" },
    ],
  });

  const slots = draft.secrets.actorStates[PROTAGONIST_ACTOR_ID]?.secrets?.beyonderSecrets;
  assert.equal(slots?.length, 2);
});

void test("configureSecret actor-beyonder throws for nonexistent actor", () => {
  const draft = createInitialState();

  assert.throws(
    () =>
      configureSecret(draft, {
        kind: "actor-beyonder",
        reason: "初始化",
        actorId: "nonexistent",
        secrets: [{ value: "秘密", revealCondition: "条件" }],
      }),
    /actor 不存在/,
  );
});

void test("configureSecret actor-beyonder merges reveal conditions on reconfiguration", () => {
  const draft = createInitialState();
  setupActorSequence(draft);

  configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "首次配置",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "我可以占卜未来", revealCondition: "占卜" }],
  });

  configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "重新配置时覆盖 revealCondition",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "我可以占卜未来", revealCondition: "预言" }],
  });

  const slot = draft.secrets.actorStates[PROTAGONIST_ACTOR_ID]?.secrets?.beyonderSecrets[0];
  assert.ok(slot);
  assert.strictEqual(slot?.revealCondition, "预言");
});

void test("configureSecret actor-beyonder works for human actor (no sequence required)", () => {
  const draft = createInitialState();

  const result = configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "预配",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "疑似与非凡有关", revealCondition: "非凡" }],
  });

  assert.match(result.message, /非凡者秘密已配置/);
});

// ===========================================================================
// configureSecret — actor-private
// ===========================================================================

void test("configureSecret actor-private configures private secrets", () => {
  const draft = createInitialState();

  const result = configureSecret(draft, {
    kind: "actor-private",
    reason: "初始化",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "寻找罗塞尔日记", revealCondition: "日记" }],
  });

  assert.match(result.message, /actor secrets 已配置/);
  const slot = draft.secrets.actorStates[PROTAGONIST_ACTOR_ID]?.secrets?.privateMotives;
  assert.equal(slot?.length, 1);
  assert.equal(slot?.[0]?.value, "寻找罗塞尔日记");
  assert.strictEqual(slot?.[0]?.revealCondition, "日记");
});

void test("configureSecret actor-private throws for nonexistent actor", () => {
  const draft = createInitialState();

  assert.throws(
    () =>
      configureSecret(draft, {
        kind: "actor-private",
        reason: "初始化",
        actorId: "nonexistent",
        secrets: [{ value: "test", revealCondition: "test" }],
      }),
    /actor 不存在/,
  );
});

// ===========================================================================
// configureSecret — world-fact
// ===========================================================================

void test("configureSecret world-fact adds new hidden world fact", () => {
  const draft = createInitialState();

  const result = configureSecret(draft, {
    kind: "world-fact",
    reason: "设定世界观",
    text: "真实造物主早已陨落",
    revealCondition: "真实造物主、陨落",
    relatedActorIds: [],
  });

  assert.match(result.message, /世界事实已记录/);
  assert.equal(draft.secrets.hiddenWorldFacts.length, 1);
  assert.equal(draft.secrets.hiddenWorldFacts[0]?.text, "真实造物主早已陨落");
  assert.equal(draft.secrets.hiddenWorldFacts[0]?.revealState, "hidden");
});

void test("configureSecret world-fact merges reveal conditions for existing fact", () => {
  const draft = createInitialState();

  configureSecret(draft, {
    kind: "world-fact",
    reason: "首次设定",
    text: "真实造物主早已陨落",
    revealCondition: "真实造物主",
    relatedActorIds: [],
  });

  configureSecret(draft, {
    kind: "world-fact",
    reason: "补充条件",
    text: "真实造物主早已陨落",
    revealCondition: "陨落",
    relatedActorIds: [],
  });

  assert.equal(draft.secrets.hiddenWorldFacts.length, 1);
  assert.strictEqual(draft.secrets.hiddenWorldFacts[0]?.revealCondition, "陨落");
});

// ===========================================================================
// revealSecret
// ===========================================================================

void test("revealSecret reveals beyonder secret via claim-reveal", async () => {
  const draft = createInitialState();
  setupActorSequence(draft);

  configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "初始化",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "我是占卜家", revealCondition: "占卜家、途径" }],
  });

  const result = await revealSecret(draft, {
    kind: "claim-reveal",
    actorId: PROTAGONIST_ACTOR_ID,
    claim: "我是占卜家",
    evidence: "通过观察确认了占卜家途径的特征",
  });

  assert.equal(result.outcome, "revealed");
  assert.equal(
    draft.secrets.actorStates[PROTAGONIST_ACTOR_ID]?.secrets?.beyonderSecrets[0]?.revealState,
    "revealed",
  );
});

void test("revealSecret reveals beyonder secret via observed-reveal", async () => {
  const draft = createInitialState();
  setupActorSequence(draft);

  configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "初始化",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "序列9占卜家", revealCondition: "序列9、占卜家" }],
  });

  const result = await revealSecret(draft, {
    kind: "observed-reveal",
    actorId: PROTAGONIST_ACTOR_ID,
    trigger: "施展了序列9占卜家的能力",
    evidence: "目睹了占卜家序列9的非凡能力展示",
  });

  assert.equal(result.outcome, "revealed");
  assert.equal(
    draft.secrets.actorStates[PROTAGONIST_ACTOR_ID]?.secrets?.beyonderSecrets[0]?.revealState,
    "revealed",
  );
});

void test("revealSecret returns foreshadowed with partial evidence", async () => {
  const draft = createInitialState();
  setupActorSequence(draft);

  configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "初始化",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "他才是真正的市长", revealCondition: "市长、真实身份" }],
  });

  // Claim is completely unrelated; evidence tangentially suggests a condition
  const result = await revealSecret(draft, {
    kind: "claim-reveal",
    actorId: PROTAGONIST_ACTOR_ID,
    claim: "今天的天气不错",
    evidence: "我亲眼看到他在市政厅签署了市长的任命文件",
  });

  assert.equal(result.outcome, "foreshadowed");
  assert.ok(result.narrativeConstraints[0]?.includes("尚不足以完全揭示"));
});

void test("revealSecret returns insufficient-evidence with no match", async () => {
  const draft = createInitialState();
  setupActorSequence(draft);

  configureSecret(draft, {
    kind: "actor-beyonder",
    reason: "初始化",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "我是占卜家", revealCondition: "占卜家、途径" }],
  });

  const result = await revealSecret(draft, {
    kind: "claim-reveal",
    actorId: PROTAGONIST_ACTOR_ID,
    claim: "不相关的事情",
    evidence: "完全无关的描述",
  });

  assert.equal(result.outcome, "insufficient-evidence");
});

void test("revealSecret throws for nonexistent actor", async () => {
  const draft = createInitialState();

  await assert.rejects(
    async () =>
      revealSecret(draft, {
        kind: "claim-reveal",
        actorId: "nonexistent",
        claim: "任何内容",
        evidence: "任何证据",
      }),
    /actor 不存在/,
  );
});

void test("revealSecret reveals hidden world fact", async () => {
  const draft = createInitialState();
  setupActorSequence(draft);

  configureSecret(draft, {
    kind: "world-fact",
    reason: "世界观设定",
    text: "真实造物主早已陨落",
    revealCondition: "真实造物主、早已陨落",
    relatedActorIds: [PROTAGONIST_ACTOR_ID],
  });

  const result = await revealSecret(draft, {
    kind: "claim-reveal",
    actorId: PROTAGONIST_ACTOR_ID,
    claim: "真实造物主早已陨落",
    evidence: "古老文献记载了真实造物主早已陨落的事实",
  });

  assert.equal(result.outcome, "revealed");
  assert.equal(draft.secrets.hiddenWorldFacts[0]?.revealState, "revealed");
});

// ===========================================================================
// privateResolve
// ===========================================================================

void test("privateResolve hidden-reaction detects relevant secret", async () => {
  const draft = createInitialState();

  configureSecret(draft, {
    kind: "actor-private",
    reason: "初始化",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "寻找罗塞尔日记", revealCondition: "日记" }],
  });

  const result = await privateResolve(draft, {
    kind: "hidden-reaction",
    actorId: PROTAGONIST_ACTOR_ID,
    stimulus: "日记",
    publicContext: "角色提到了日记",
  });

  assert.equal(result.outcome, "subtle-reaction");
});

void test("privateResolve hidden-reaction returns no-special-effect without relevant secret", async () => {
  const draft = createInitialState();

  const result = await privateResolve(draft, {
    kind: "hidden-reaction",
    actorId: PROTAGONIST_ACTOR_ID,
    stimulus: "无关话题",
    publicContext: "闲聊",
  });

  assert.equal(result.outcome, "no-special-effect");
});

void test("privateResolve secret-compatibility detects both actors have secrets", async () => {
  const draft = createInitialState();

  addAllyToState(draft, "ally-1");

  configureSecret(draft, {
    kind: "actor-private",
    reason: "初始化主角",
    actorId: PROTAGONIST_ACTOR_ID,
    secrets: [{ value: "寻找罗塞尔日记", revealCondition: "日记" }],
  });
  configureSecret(draft, {
    kind: "actor-private",
    reason: "初始化盟友",
    actorId: "ally-1",
    secrets: [{ value: "隐藏身份", revealCondition: "身份" }],
  });

  const result = await privateResolve(draft, {
    kind: "secret-compatibility",
    actorId: PROTAGONIST_ACTOR_ID,
    targetActorId: "ally-1",
    interaction: "交换情报",
  });

  assert.equal(result.outcome, "no-special-effect");
});

void test("privateResolve secret-compatibility returns no-special-effect without secrets", async () => {
  const draft = createInitialState();

  addAllyToState(draft, "ally-1");

  const result = await privateResolve(draft, {
    kind: "secret-compatibility",
    actorId: PROTAGONIST_ACTOR_ID,
    targetActorId: "ally-1",
    interaction: "交换情报",
  });

  assert.equal(result.outcome, "no-special-effect");
});
