/**
 * Progress reporting shared by the ingestion and ratings steps.
 *
 * All three phases already logged their progress to the server console; this
 * lets the same information reach the browser, so a long import shows what it
 * is doing instead of an unchanging "Importing..." label.
 */

export type IngestPhase = "jolpica" | "openf1" | "ratings";

export type IngestProgress = {
  phase: IngestPhase;
  /** Human-readable description of the current step. */
  message: string;
  /** Items finished in this phase, when the total is known up front. */
  completed?: number;
  total?: number;
};

export type ProgressReporter = (progress: IngestProgress) => void;
