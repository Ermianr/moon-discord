import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareToBaseline,
  median,
  percentile95,
  processCv,
} from "../benches/lib/compare.js";

test("median is the middle sample for odd counts and the mean of the two middle for even", () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([4, 2]), 3);
});

test("p95 uses nearest-rank on sorted microseconds", () => {
  const samples: number[] = [];
  for (let i = 1; i <= 20; i += 1) {
    samples.push(i);
  }
  assert.equal(percentile95(samples), 19);
});

test("process CV over 5% is invalid", () => {
  assert.equal(processCv([100, 100, 100]) > 0.05, false);
  assert.equal(processCv([100, 130, 70]) > 0.05, true);
});

test("compare fails when aggregated median or p95 is more than 10% worse", () => {
  const baseline = { medianUs: 100, p95Us: 120 };
  const worseMedian = compareToBaseline(baseline, { medianUs: 111, p95Us: 120 }, 0.01);
  assert.equal(worseMedian.verdict, "fail");
  const worseP95 = compareToBaseline(baseline, { medianUs: 100, p95Us: 133 }, 0.01);
  assert.equal(worseP95.verdict, "fail");
});

test("compare is invalid when process CV exceeds 5% and does not rewrite the baseline", () => {
  const baseline = { medianUs: 100, p95Us: 120 };
  const result = compareToBaseline(
    baseline,
    { medianUs: 100, p95Us: 120, medianCv: 0.06, p95Cv: 0.01 },
    0.06,
  );
  assert.equal(result.verdict, "invalid");
  assert.equal(result.wroteBaseline, false);
});

test("compare passes within 10% and never writes the baseline", () => {
  const baseline = { medianUs: 100, p95Us: 120 };
  const result = compareToBaseline(baseline, { medianUs: 109, p95Us: 131 }, 0.01);
  assert.equal(result.verdict, "pass");
  assert.equal(result.wroteBaseline, false);
});
