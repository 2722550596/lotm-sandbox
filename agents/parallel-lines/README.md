# Parallel-Line Subagent Quick Reference

The main GM may call the `parallel-line` subagent after a major beat ends, after a long time skip, or when a faction should act outside the player's view.

## Call input

Give a narrow input, not the full main state:

```json
{
  "lineId": "lancer-church",
  "timeWindow": { "start": "2004-01-30T07:00:00.000Z", "end": "2004-01-30T09:00:00.000Z" },
  "currentArc": "opening",
  "currentBeat": "Ryuudou Temple scouting wrap-up",
  "allowedScope": ["perimeter scouting", "Church report", "future surveillance hook"],
  "forbiddenEscalations": [
    "trigger mountain-gate battle",
    "formally manifest Sasaki Kojirou",
    "force Medea into direct combat"
  ],
  "knownFacts": ["facts this faction actually knows"],
  "privateFacts": ["this faction's own secrets"],
  "actorGoals": ["goal for this window"],
  "previousLineState": "summary of the previous state of this line",
  "playerSideSummary": "only player-side facts this faction could plausibly care about"
}
```

## Landing flow

1. Read the subagent's JSON output.
2. Write only approved backstage facts through `manage_undercurrent`.
3. `visibility` may be only `secret` or `foreshadowed`.
4. Rewrite player-visible material as traces, rumors, dreams, abnormal actions, or aftermath. Do not show `privateSummary` directly.

## Lancer / Church example

- `lineId`: `lancer-church`
- `allowedScope`: Cu Chulainn perimeter scouting, reporting to Kirei, Church supervisor orders, future surveillance hooks
- `forbiddenEscalations`: entering the player's current scene to kill, early decisive battle, full Bazett truth leak
- Common hooks: night surveillance near Ryuudou Temple, late Church lights, a flash of blue Lancer presence, Kirei's interest in a location increasing
