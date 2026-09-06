export type Baseline = {
  medianUs: number;
  p95Us: number;
};

export type ProcessRun = {
  medianUs: number;
  p95Us: number;
  medianCv?: number;
  p95Cv?: number;
};

export type CompareResult = {
  verdict: "pass" | "fail" | "invalid";
  wroteBaseline: boolean;
};

export { median, percentile95 } from "./percentiles.js";

export function processCv(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value !== undefined) {
      sum += value;
    }
  }
  const mean = sum / values.length;
  if (mean === 0) {
    return 0;
  }
  let squares = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value !== undefined) {
      const delta = value - mean;
      squares += delta * delta;
    }
  }
  const stddev = Math.sqrt(squares / values.length);
  return stddev / mean;
}

export function compareToBaseline(baseline: Baseline, run: ProcessRun, cv: number): CompareResult {
  const medianCv = run.medianCv === undefined ? 0 : run.medianCv;
  const p95Cv = run.p95Cv === undefined ? 0 : run.p95Cv;
  if (cv > 0.05 || medianCv > 0.05 || p95Cv > 0.05) {
    return { verdict: "invalid", wroteBaseline: false };
  }
  if (run.medianUs > baseline.medianUs * 1.1 || run.p95Us > baseline.p95Us * 1.1) {
    return { verdict: "fail", wroteBaseline: false };
  }
  return { verdict: "pass", wroteBaseline: false };
}
