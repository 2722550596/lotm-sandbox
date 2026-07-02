import { Type } from "typebox";

/** commit_turn 的顶层 time 裁决入口 schema。 */
export function timePolicySchema(): ReturnType<typeof Type.Object> {
  return Type.Object({
    kind: Type.String({
      description:
        "允许: elapsed / travel。等待、休息、睡眠、守夜、治疗、调查等非移动耗时用 elapsed；玩家在叙事中改变地点用 travel",
    }),
    elapsedMinutes: Type.Optional(
      Type.Object({
        minutes: Type.Integer({
          description:
            "叙事实际经过的分钟数。把正文里从上一轮到这一轮的所有事件、对话、移动、等待、休息、睡觉加起来算总时间，不要凭感觉填",
        }),
        reason: Type.String({
          description:
            '列出正文里哪些活动耗了时间，例如："在廷根街市调查 2 小时 + 去诊所 1 小时 + 吃晚饭 1 小时"',
        }),
      }),
    ),
    location: Type.Optional(locationSchema()),
  });
}

function locationSchema(): ReturnType<typeof Type.Object> {
  return Type.Object({
    region: Type.String(),
    site: Type.String(),
    detail: Type.String(),
    boundary: Type.String({
      description: "地点边界类型，允许: normal / bounded-field / reality-marble / otherworld",
    }),
  });
}
