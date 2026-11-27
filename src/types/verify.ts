// Types for the verify-zeni driver (scripts/verify/run.ts).

export type VerifySize = { width: number; height: number };

export type VerifyTiming = { page: string; size: string; ms: number };

export type VerifyReport = {
  seedRows: number;
  imported: string;
  timings: VerifyTiming[];
  screenshots: string[];
};
