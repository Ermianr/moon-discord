import { median, percentile95 } from "./percentiles.js";

function nowMs(): number {
  return performance.now();
}

export async function measureUs(
  warmup: number,
  iterations: number,
  work: () => Promise<void>,
): Promise<number[]> {
  for (let i = 0; i < warmup; i += 1) {
    await work();
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = nowMs();
    await work();
    const elapsedMs = nowMs() - start;
    samples.push(elapsedMs * 1000);
  }
  return samples;
}

export function reportSamples(samples: number[]): void {
  const report: { medianUs: number; p95Us: number } = {
    medianUs: median(samples),
    p95Us: percentile95(samples),
  };
  console.log(JSON.stringify(report));
}
