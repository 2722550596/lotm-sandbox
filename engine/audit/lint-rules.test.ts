import assert from "node:assert/strict";
import test from "node:test";

import {
  collectUnrevealedSecretStrings,
  findSecretLeaks,
  lintFinalProse,
  lintProseLength,
  proseLengthContextFromPacket,
} from "./lint-rules.ts";

function ruleIds(prose: string): string[] {
  return lintFinalProse(prose).map((f) => f.ruleId);
}

void test("opening-delivery-wrapper hits delivery openings", () => {
  assert.ok(ruleIds("好的，以下是本轮的剧情。").includes("opening-delivery-wrapper"));
  assert.ok(ruleIds("以下是状态变化。").includes("opening-delivery-wrapper"));
  assert.ok(ruleIds("那么，战斗开始了。").includes("opening-delivery-wrapper"));
  assert.ok(ruleIds("状态已经更新。").includes("opening-delivery-wrapper"));
});

void test("opening-delivery-wrapper ignores mid-text 那么", () => {
  assert.ok(!ruleIds("她抬起头。那么近的距离，呼吸可闻。").includes("opening-delivery-wrapper"));
});

void test("opening-delivery-wrapper skips leading blank lines", () => {
  assert.ok(ruleIds("\n\n好的，开始。").includes("opening-delivery-wrapper"));
});

void test("pseudo-menu-ending hits 你可以…也可以…", () => {
  assert.ok(ruleIds("夜风掠过。你可以继续追击，也可以先退回巷口。").includes("pseudo-menu-ending"));
});

void test("pseudo-menu-ending hits 是…还是…？", () => {
  assert.ok(ruleIds("门就在眼前。是推门进去还是绕到后窗？").includes("pseudo-menu-ending"));
});

void test("pseudo-menu-ending hits 左边是…右边是…", () => {
  assert.ok(ruleIds("走廊分岔。左边是仓库，右边是楼梯间。").includes("pseudo-menu-ending"));
});

void test("pseudo-menu-ending only checks the ending window", () => {
  const prose = `你可以信任她，也可以不信。${"夜色沉下来。".repeat(40)}刀尖抵在门板上。`;
  assert.ok(!ruleIds(prose).includes("pseudo-menu-ending"));
});

void test("markdown divider and heading detected", () => {
  const ids = ruleIds("第一段。\n---\n## 战斗结算\n第二段。");
  assert.ok(ids.includes("markdown-divider"));
  assert.ok(ids.includes("markdown-heading"));
});

void test("machine-artifact hits JSON-ish lines", () => {
  assert.ok(ruleIds('结算如下：\n{\n"kind": "elapsed"\n}').includes("machine-artifact"));
});

void test("em-dash narration does not hit markdown-divider", () => {
  assert.ok(!ruleIds("她说——不行。").includes("markdown-divider"));
});

void test("negation-reversal hits 并非…而是 and 与其说", () => {
  assert.ok(ruleIds("那并非恐惧，而是某种更古老的东西。").includes("negation-reversal"));
  assert.ok(ruleIds("与其说是愤怒，不如说是悲哀。").includes("negation-reversal"));
});

void test("negation-reversal-colloquial hits narration variants but spares dialogue", () => {
  const rule = "negation-reversal-colloquial";
  // 逗号变体
  assert.ok(ruleIds("不是看出来的，是摸出来的。").includes(rule));
  // 句号变体（逗号版被堵后的绕逃路径）
  assert.ok(ruleIds("不是商量。是判断。").includes(rule));
  // 台词里的正常纠正句放过
  assert.ok(!ruleIds("「不是我干的，是他先动手的。」").includes(rule));
  assert.ok(!ruleIds("「不是商量。是判断。」").includes(rule));
  // 普通否定句 + 长叙述接句放过
  assert.ok(
    !ruleIds("你不是第一次来这里。是夜里的钟声把这条路变得陌生，让每一步都踩在回忆外面。").includes(
      rule,
    ),
  );
});

void test("negative-listing and false-transformation hit narration, spare dialogue", () => {
  assert.ok(ruleIds("这不是侦察。不是巡逻。是围猎。").includes("negative-listing"));
  assert.ok(!ruleIds("「不是侦察。不是巡逻。是围猎。」").includes("negative-listing"));
  assert.ok(ruleIds("那道视线不再是稳定的指节，而是折碎的冷意。").includes("false-transformation"));
  assert.ok(!ruleIds("「我不再是从者，而是你的剑。」").includes("false-transformation"));
  assert.ok(!ruleIds("他不再说话。是雨声盖过了一切吗。").includes("false-transformation"));
});

function endingProse(line: string): string {
  return "正文铺垫。".repeat(30) + "\n" + line;
}

void test("pseudo-menu-in-dialogue hits option-enumeration handoffs at the ending", () => {
  const rule = "pseudo-menu-in-dialogue";
  const ending = endingProse;
  assert.ok(ruleIds(ending("「想再往前探，或者看完就走，由你定。」")).includes(rule));
  assert.ok(ruleIds(ending("先撤回去，或者赌一把冲过去，你来定。")).includes(rule));
  // 「或者」的普通叙述用法与开放式等待放过
  assert.ok(!ruleIds(ending("她转过身，或者说试图转过身，肩膀撞在了门框上。")).includes(rule));
  assert.ok(!ruleIds(ending("退路还在，她的手搭在刀柄上，等你开口。")).includes(rule));
});

void test("empty-atmosphere hits stock phrases", () => {
  assert.ok(ruleIds("空气中弥漫着血腥味。").includes("empty-atmosphere"));
  assert.ok(ruleIds("她的脸色显得格外苍白。").includes("empty-atmosphere"));
  assert.ok(ruleIds("一种难以言喻的感觉。").includes("empty-atmosphere"));
});

void test("perception-report hits tell-first sensory report verbs", () => {
  assert.ok(ruleIds("你看到门缝里漏出一点光。").includes("perception-report"));
  assert.ok(ruleIds("她听到楼上传来第二声脚步。").includes("perception-report"));
});

void test("empty-motion-beat hits battle stock beats", () => {
  assert.ok(ruleIds("就是现在。她动了。").includes("empty-motion-beat"));
});

void test("water-metaphor hits banned cluster", () => {
  assert.ok(ruleIds("心湖泛起涟漪。").includes("water-metaphor"));
  assert.ok(ruleIds("像抓住最后一根浮木。").includes("water-metaphor"));
});

void test("fake-climax hits banned lines", () => {
  assert.ok(ruleIds("你第一次真正看清了她。").includes("fake-climax"));
  assert.ok(ruleIds("你意识到自己输了。").includes("fake-climax"));
});

void test("double-simile hits consecutive similes", () => {
  assert.ok(ruleIds("声音像碎玻璃，像断裂的弦。").includes("double-simile"));
  assert.ok(ruleIds("像潮水，又仿佛火焰。").includes("double-simile"));
});

void test("report-sentence hits status report wording", () => {
  assert.ok(ruleIds("目标完成，威胁提升。").includes("report-sentence"));
});

void test("clean prose produces zero findings", () => {
  const prose =
    "刀锋擦着她的肩头掠过，木门在背后裂开一道缝。楼上传来第二声脚步——比第一声更近。她攥紧了袖中的令咒，掌心全是汗。";
  assert.deepEqual(lintFinalProse(prose), []);
});

void test("lintProseLength flags render drafts below the event-weight floor", () => {
  const findings = lintProseLength("她点头。门外雨声近了一点。", {
    eventWeight: "normal",
    resolvedChangeCount: 1,
    npcStanceCount: 0,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.ruleId, "underlength-prose");
  assert.match(findings[0]?.match ?? "", /\d+\/295 字/u);
});

void test("lintProseLength accepts long enough prose", () => {
  const prose = "她把伞沿着门缝收拢。".repeat(40);
  assert.deepEqual(
    lintProseLength(prose, { eventWeight: "light", resolvedChangeCount: 1, npcStanceCount: 0 }),
    [],
  );
});

void test("proseLengthContextFromPacket reads render packet weight and counts", () => {
  const context = proseLengthContextFromPacket({
    needsRender: true,
    eventWeight: "heavy",
    resolvedChanges: ["伤口裂开", "敌人逼近"],
    npcStances: [{ actorId: "rin" }],
  });
  assert.deepEqual(context, { eventWeight: "heavy", resolvedChangeCount: 2, npcStanceCount: 1 });
  assert.equal(proseLengthContextFromPacket({ needsRender: false }), undefined);
});

void test("findSecretLeaks flags unrevealed true name as block", () => {
  const findings = findSecretLeaks("她低声说：我是两仪式。", ["两仪式"]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "block");
  assert.equal(findings[0]?.ruleId, "unrevealed-secret-leak");
  assert.equal(findings[0]?.match, "两仪式");
});

void test("findSecretLeaks reports every occurrence", () => {
  assert.equal(findSecretLeaks("两仪式……两仪式！", ["两仪式"]).length, 2);
});

void test("findSecretLeaks returns empty on no match and empty secret", () => {
  assert.deepEqual(findSecretLeaks("Saber 沉默着。", ["两仪式"]), []);
  assert.deepEqual(findSecretLeaks("任意文本", [""]), []);
});

void test("collectUnrevealedSecretStrings extracts only unrevealed secrets", () => {
  const secrets = {
    actorStates: {
      alice: {
        actorId: "alice",
        secrets: {
          actorId: "alice",
          pathwaySecret: { value: "命运之轮", revealState: "hidden", revealConditions: [] },
          sequenceSecret: { value: "序列4", revealState: "revealed", revealConditions: [] },
          beyonderSecrets: [
            { value: "我有秘偶", revealState: "hidden", revealConditions: [] },
            { value: "我在追踪罗塞尔", revealState: "revealed", revealConditions: [] },
          ],
          privateMotives: [
            { value: "寻找失落的典籍", revealState: "hidden", revealConditions: [] },
          ],
          unrevealedAffiliations: [
            { value: "神秘学会", revealState: "hidden", revealConditions: [] },
          ],
        },
      },
    },
  };
  const out = collectUnrevealedSecretStrings(secrets);
  assert.deepEqual(
    out.toSorted(),
    ["命运之轮", "我有秘偶", "寻找失落的典籍", "神秘学会"].toSorted(),
  );
});

void test("collectUnrevealedSecretStrings skips revealed secrets", () => {
  const out = collectUnrevealedSecretStrings({
    actorStates: {
      a: {
        actorId: "a",
        secrets: { pathwaySecret: { value: "命运之轮", revealState: "revealed" } },
      },
    },
  });
  assert.deepEqual(out, []);
});

void test("collectUnrevealedSecretStrings tolerates malformed input", () => {
  assert.deepEqual(collectUnrevealedSecretStrings(undefined), []);
  assert.deepEqual(collectUnrevealedSecretStrings("x"), []);
  assert.deepEqual(collectUnrevealedSecretStrings({ actorStates: 3 }), []);
});
