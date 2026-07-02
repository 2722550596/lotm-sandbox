import type { TimelineId } from "../state/state-enum-schemas.ts";

export type ParallelLineOutcome = "no-change" | "progress" | "escalation" | "blocked";

export interface ParallelLineTimeWindow {
  start: string;
  end: string;
}

export interface ParallelLineInput {
  lineId: string;
  timelineId: TimelineId;
  genreContract: string;
  timeWindow: ParallelLineTimeWindow;
  currentArc: string;
  currentBeat: string;
  allowedScope: string[];
  forbiddenEscalations: string[];
  knownFacts: string[];
  privateFacts: string[];
  actorGoals: string[];
  previousLineState: string;
  playerSideSummary: string;
  excludedActorIds?: string[];
  excludedPressureTypes?: string[];
  preferredPressureType?: string;
  majorBeatEnd?: boolean;
  arcTransition?: boolean;
}

export type ParallelLineToneDriftRisk = "none" | "watch" | "drifting";

export interface ParallelLineOutput {
  lineId: string;
  timelineId: TimelineId;
  actorIds: string[];
  timeRange: ParallelLineTimeWindow;
  outcome: ParallelLineOutcome;
  privateSummary: string;
  secretStateChanges: string[];
  publicLeakCandidates: string[];
  futureHooks: string[];
  toneDriftRisk: ParallelLineToneDriftRisk;
  genreFitNotes: string[];
  riskFlags: string[];
  optionalNarrativeSnippet: string | null;
}
