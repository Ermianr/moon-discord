import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareToBaseline, processCv, type Baseline } from "../benches/lib/compare.js";
import { scenarioTouched } from "../benches/lib/paths.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROCESS_COUNT = 3;
const MAX_ATTEMPTS = 10;

type Filter = {
  scenario: string;
  compiler: string;
  lane: string;
  backend?: string;
  entry: string;
  baseline: string;
  paths: string[];
};

type ProcessReport = {
  medianUs: number;
  p95Us: number;
};

function allFilterPaths(filters: Record<string, Filter>): string[] {
  const files: string[] = [];
  const names = Object.keys(filters);
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (name === undefined) {
      continue;
    }
    const filter = filters[name];
    if (filter === undefined) {
      continue;
    }
    for (let j = 0; j < filter.paths.length; j += 1) {
      const prefix = filter.paths[j];
      if (prefix !== undefined) {
        files.push(prefix);
      }
    }
  }
  return files;
}

function changedFiles(filters: Record<string, Filter>): string[] {
  if (process.env.HOT_PATH_ALL === "1") {
    return allFilterPaths(filters);
  }
  const base = process.env.HOT_PATH_BASE;
  const head = process.env.HOT_PATH_HEAD;
  if (base === undefined || base === "" || head === undefined || head === "") {
    return [];
  }
  const output = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const lines = output.split("\n");
  const files: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && line !== "") {
      files.push(line);
    }
  }
  return files;
}

function parseReport(text: string): ProcessReport {
  const trimmed = text.trim();
  const parsed: unknown = JSON.parse(trimmed);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("medianUs" in parsed) ||
    !("p95Us" in parsed)
  ) {
    throw new Error("bench stdout must be { medianUs, p95Us }");
  }
  const medianUs = parsed.medianUs;
  const p95Us = parsed.p95Us;
  if (typeof medianUs !== "number" || typeof p95Us !== "number") {
    throw new Error("bench percentiles must be numbers");
  }
  return { medianUs, p95Us };
}

function readBaseline(filePath: string): Baseline | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("medianUs" in parsed) ||
    !("p95Us" in parsed)
  ) {
    throw new Error(`${filePath} must include medianUs and p95Us`);
  }
  const medianUs = parsed.medianUs;
  const p95Us = parsed.p95Us;
  if (typeof medianUs !== "number" || typeof p95Us !== "number") {
    throw new Error(`${filePath} percentiles must be numbers`);
  }
  return { medianUs, p95Us };
}

function buildElf(entry: string, backend: string | undefined, output: string): void {
  const args = ["build", entry, "-o", output];
  if (backend !== undefined && backend !== "") {
    args.push("--backend", backend);
  }
  if (args.includes("--dynamic")) {
    throw new Error("hot-path benches must not pass --dynamic");
  }
  execFileSync("scriptc", args, { cwd: repoRoot, stdio: "inherit" });
}

function runElf(binary: string): ProcessReport {
  const text = execFileSync(binary, [], { cwd: repoRoot, encoding: "utf8" });
  return parseReport(text);
}

function medianOf(values: number[]): number {
  const copy: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value !== undefined) {
      copy.push(value);
    }
  }
  copy.sort((a, b) => a - b);
  const mid = Math.floor(copy.length / 2);
  if (copy.length % 2 === 1) {
    const value = copy[mid];
    return value === undefined ? 0 : value;
  }
  const a = copy[mid - 1];
  const b = copy[mid];
  if (a === undefined || b === undefined) {
    return 0;
  }
  return (a + b) / 2;
}

function runScenario(filter: Filter): void {
  const baselinePath = path.join(repoRoot, filter.baseline);
  const baseline = readBaseline(baselinePath);
  if (baseline === undefined) {
    console.log(`skip ${filter.scenario}: no baseline file`);
    return;
  }
  const binary = path.join(os.tmpdir(), `moon-discord-${filter.scenario}`);
  buildElf(filter.entry, filter.backend, binary);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const medians: number[] = [];
    const p95s: number[] = [];
    for (let i = 0; i < PROCESS_COUNT; i += 1) {
      const report = runElf(binary);
      medians.push(report.medianUs);
      p95s.push(report.p95Us);
    }
    const medianCv = processCv(medians);
    const p95Cv = processCv(p95s);
    const aggregated = {
      medianUs: medianOf(medians),
      p95Us: medianOf(p95s),
      medianCv,
      p95Cv,
    };
    const cv = medianCv > p95Cv ? medianCv : p95Cv;
    const result = compareToBaseline(baseline, aggregated, cv);
    if (result.verdict === "invalid") {
      console.log(`invalid ${filter.scenario} attempt ${String(attempt)} cv=${String(cv)}`);
      continue;
    }
    if (result.wroteBaseline) {
      throw new Error("hot-path gate must not rewrite baselines");
    }
    if (result.verdict === "fail") {
      console.error(
        `${filter.scenario} regression: median ${String(aggregated.medianUs)} vs ${String(baseline.medianUs)}, p95 ${String(aggregated.p95Us)} vs ${String(baseline.p95Us)}`,
      );
      process.exit(1);
    }
    console.log(`pass ${filter.scenario} medianUs=${String(aggregated.medianUs)} p95Us=${String(aggregated.p95Us)}`);
    return;
  }
  console.error(`${filter.scenario} remained invalid (CV > 5%) after ${String(MAX_ATTEMPTS)} attempts`);
  process.exit(1);
}

const filters = JSON.parse(fs.readFileSync(path.join(repoRoot, "benches/path-filters.json"), "utf8")) as Record<
  string,
  Filter
>;
const files = changedFiles(filters);
const names = Object.keys(filters);
for (let i = 0; i < names.length; i += 1) {
  const name = names[i];
  if (name === undefined) {
    continue;
  }
  const filter = filters[name];
  if (filter === undefined) {
    continue;
  }
  if (!scenarioTouched(files, filter.paths)) {
    console.log(`skip ${filter.scenario}: path filter`);
    continue;
  }
  runScenario(filter);
}
