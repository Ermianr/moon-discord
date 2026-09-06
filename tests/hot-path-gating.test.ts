import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scenarioTouched } from "../benches/lib/paths.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("hot-path path prefixes match the delivery note", () => {
  const filters = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "benches/path-filters.json"), "utf8"),
  ) as {
    decode: { paths: string[] };
    "rest-dispatch": { paths: string[] };
    heartbeat: { paths: string[]; backend?: string; lane: string };
  };
  assert.deepEqual(filters.decode.paths, [
    "src/decode/",
    "benches/decode/",
    "benches/lib/",
    "fixtures/decode/",
    "scripts/hot-path-gate.ts",
  ]);
  assert.deepEqual(filters["rest-dispatch"].paths, [
    "src/rest/",
    "benches/rest-dispatch/",
    "benches/lib/",
    "fixtures/rest-dispatch/",
    "scripts/hot-path-gate.ts",
  ]);
  assert.deepEqual(filters.heartbeat.paths, [
    "src/session.ts",
    "src/session/",
    "benches/heartbeat/",
    "benches/lib/",
    "fixtures/heartbeat/",
    "scripts/hot-path-gate.ts",
  ]);
  assert.equal("backend" in filters.heartbeat, false);
  assert.equal(filters.heartbeat.lane, "default-gateway");
});

test("docs-only changes do not touch Decode, REST dispatch, or heartbeat ELF prefixes", () => {
  const files = ["docs/research/performance-contract.md", "AGENTS.md", ".agents/skills/tdd/SKILL.md"];
  assert.equal(scenarioTouched(files, ["src/decode/", "benches/decode/", "fixtures/decode/"]), false);
  assert.equal(
    scenarioTouched(files, ["src/rest/", "benches/rest-dispatch/", "fixtures/rest-dispatch/"]),
    false,
  );
  assert.equal(
    scenarioTouched(files, ["src/session.ts", "src/session/", "benches/heartbeat/", "fixtures/heartbeat/"]),
    false,
  );
  assert.equal(scenarioTouched(files, ["src/rest/multipart.ts"]), false);
});

test("multipart encode smoke prefixes are not a fourth hot-path scenario", () => {
  const filters = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "benches/path-filters.json"), "utf8"),
  ) as Record<string, { paths?: string[] }>;
  assert.equal(Object.keys(filters).length, 3);
  for (const name of Object.keys(filters)) {
    assert.notEqual(name, "multipart");
    assert.notEqual(name, "multipart-encode");
  }
  assert.equal(scenarioTouched(["src/rest/multipart.ts"], ["src/rest/multipart.ts"]), true);
  assert.equal(scenarioTouched(["src/rest/rate-limit.ts"], ["src/rest/multipart.ts"]), false);
});

test("Decode, Rest, and Session implementation paths trigger their ELF scenarios", () => {
  assert.equal(
    scenarioTouched(["src/decode/index.ts"], ["src/decode/", "benches/decode/", "fixtures/decode/"]),
    true,
  );
  assert.equal(
    scenarioTouched(["src/rest/rate-limit.ts"], ["src/rest/", "benches/rest-dispatch/", "fixtures/rest-dispatch/"]),
    true,
  );
  assert.equal(
    scenarioTouched(["src/session.ts"], ["src/session.ts", "src/session/", "benches/heartbeat/", "fixtures/heartbeat/"]),
    true,
  );
});

test("benches are not static-contract consumer entries or npm exports", () => {
  const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, "static-contract.json"), "utf8")) as {
    entries: Array<{ path: string }>;
  };
  assert.equal(
    contract.entries.some((entry) => entry.path.startsWith("benches/")),
    false,
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
    files: string[];
  };
  assert.equal("benches" in pkg.exports, false);
  assert.equal(pkg.files.includes("benches"), false);
  assert.equal(pkg.files.includes("fixtures"), false);
});

test("git baselines are keyed by scenario, compiler, and compile lane", () => {
  const expectedLane = {
    decode: "llvm-rest",
    "rest-dispatch": "llvm-rest",
    heartbeat: "default-gateway",
  } as const;
  for (const name of ["decode", "rest-dispatch", "heartbeat"] as const) {
    const baseline = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "benches", name, "baseline.json"), "utf8"),
    ) as {
      scenario: string;
      compiler: string;
      lane: string;
      platform: string;
      medianUs: number;
      p95Us: number;
    };
    assert.equal(baseline.scenario, name);
    assert.equal(baseline.compiler, "0.0.36");
    assert.equal(baseline.lane, expectedLane[name]);
    assert.equal(baseline.platform, "linux-x86_64-glibc");
    assert.equal(typeof baseline.medianUs, "number");
    assert.equal(typeof baseline.p95Us, "number");
  }
});

test("PR CI path-filters hot-path ELFs without --dynamic", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/pr.yml"), "utf8");
  assert.match(workflow, /hot-path-gate/);
  assert.equal(workflow.includes("--dynamic"), false);
});

test("heartbeat bench drives Session with cache off and no Gateway TLS", () => {
  const source = fs.readFileSync(path.join(repoRoot, "benches/heartbeat/main.ts"), "utf8");
  assert.match(source, /startSession/);
  assert.equal(source.includes("cache: true"), false);
  assert.equal(source.includes("tls.connect"), false);
  assert.equal(source.includes("--dynamic"), false);
});
