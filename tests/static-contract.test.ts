import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

type PackListing = { files: Array<{ path: string }> };

function isPackListing(value: unknown): value is PackListing {
  return typeof value === "object" && value !== null && "files" in value && Array.isArray(value.files);
}

function packedFilePaths(listingJson: string): string[] {
  const parsed: unknown = JSON.parse(listingJson);
  let pack: PackListing | undefined;
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    if (isPackListing(first)) {
      pack = first;
    }
  } else if (typeof parsed === "object" && parsed !== null && "moon-discord" in parsed) {
    const named = parsed["moon-discord"];
    if (isPackListing(named)) {
      pack = named;
    }
  }
  if (pack === undefined) {
    throw new Error("npm pack --json did not include a file listing");
  }
  return pack.files.map((file) => file.path);
}

test("reads npm pack --json array shape from npm 10 and 11", () => {
  assert.deepEqual(
    packedFilePaths(JSON.stringify([{ files: [{ path: "src/index.ts" }] }])),
    ["src/index.ts"],
  );
});

test("reads npm pack --json object shape from npm 12", () => {
  assert.deepEqual(
    packedFilePaths(JSON.stringify({ "moon-discord": { files: [{ path: "src/index.ts" }] } })),
    ["src/index.ts"],
  );
});

test("static-contract.json names REST LLVM and Gateway default-backend lanes without --dynamic", () => {
  const contractPath = path.join(repoRoot, "static-contract.json");
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8")) as {
    compiler: string;
    dynamic: string;
    npmStatic: string[];
    platform: string;
    entries: Array<{
      name: string;
      path: string;
      import: string;
      backend?: string;
    }>;
  };

  assert.equal(contract.compiler, "0.0.36");
  assert.equal(contract.dynamic, "forbidden");
  assert.deepEqual(contract.npmStatic, ["moon-discord"]);
  assert.equal(contract.platform, "linux-x86_64-glibc");
  assert.equal(contract.entries.length, 2);
  const restEntry = contract.entries[0];
  const gatewayEntry = contract.entries[1];
  assert.ok(restEntry !== undefined);
  assert.ok(gatewayEntry !== undefined);
  assert.equal(restEntry.name, "rest");
  assert.equal(restEntry.path, "representatives/rest.ts");
  assert.equal(restEntry.import, "moon-discord/rest");
  assert.equal(restEntry.backend, "llvm");
  assert.equal(gatewayEntry.name, "gateway");
  assert.equal(gatewayEntry.path, "representatives/gateway.ts");
  assert.equal(gatewayEntry.import, "moon-discord");
  assert.equal("backend" in gatewayEntry, false);

  const restSource = fs.readFileSync(path.join(repoRoot, restEntry.path), "utf8");
  assert.match(restSource, /from "\.\.\/src\/rest\.js"/);
  assert.match(restSource, /files:/);
  assert.equal(restSource.includes("--dynamic"), false);
  assert.equal(restSource.includes("process.env"), false);
  assert.equal(restSource.includes("tls.connect"), false);

  const gatewaySource = fs.readFileSync(path.join(repoRoot, gatewayEntry.path), "utf8");
  assert.match(gatewaySource, /from "\.\.\/src\/index\.js"/);
  assert.match(gatewaySource, /shards: "recommended"/);
  assert.match(gatewaySource, /files:/);
  assert.match(gatewaySource, /MESSAGE_CREATE/);
  assert.match(gatewaySource, /\.connect\(/);
  assert.equal(gatewaySource.includes("--dynamic"), false);
  assert.equal(gatewaySource.includes("process.env"), false);
});

test("npm tarball ships ESM JS, d.ts, src, and static-contract — not tests or agents", () => {
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, encoding: "utf8" });
  const listing = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const files = packedFilePaths(listing);

  assert.ok(files.includes("static-contract.json"));
  assert.ok(files.some((file) => file.startsWith("src/")));
  assert.ok(files.includes("dist/rest.js"));
  assert.ok(files.includes("dist/rest.d.ts"));
  assert.equal(
    files.some((file) => file.startsWith("tests/") || file.startsWith(".agents/") || file.startsWith("representatives/")),
    false,
  );
});

test("CHANGELOG has 0.1.0, 0.2.0, and 0.4.0 Keep a Changelog sections", () => {
  const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /^## \[0\.1\.0\]/m);
  assert.match(changelog, /^## \[0\.2\.0\]/m);
  assert.match(changelog, /^## \[0\.4\.0\]/m);
  assert.match(changelog, /Keep a Changelog/);
});

test("PR CI typechecks, tests, and covers contract entries without a Discord token", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/pr.yml"), "utf8");
  const coverage = fs.readFileSync(path.join(repoRoot, "scripts/static-coverage.mjs"), "utf8");
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /static-coverage\.mjs/);
  assert.match(coverage, /scriptc/);
  assert.match(coverage, /--backend/);
  assert.match(coverage, /tls\.connect/);
  assert.match(coverage, /tls\.connectCb/);
  assert.match(coverage, /backend === "llvm"/);
  assert.equal(workflow.includes("--dynamic"), false);
  assert.equal(workflow.includes("DISCORD_TOKEN"), false);
  assert.equal(workflow.includes("BOT_TOKEN"), false);
});

test("PR CI runs a non-budget createTestClient MESSAGE_CREATE smoke", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/pr.yml"), "utf8");
  const smoke = fs.readFileSync(path.join(repoRoot, "scripts/message-create-smoke.ts"), "utf8");
  assert.match(workflow, /message-create-smoke/);
  assert.match(smoke, /createTestClient/);
  assert.match(smoke, /MESSAGE_CREATE/);
  assert.equal(smoke.includes("medianUs"), false);
  assert.equal(smoke.includes("p95Us"), false);
  assert.equal(smoke.includes("--dynamic"), false);
});

test("PR CI runs a non-budget multipart encode smoke when Rest multipart is touched", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/pr.yml"), "utf8");
  const smokeGate = fs.readFileSync(path.join(repoRoot, "scripts/multipart-smoke-gate.ts"), "utf8");
  const smoke = fs.readFileSync(path.join(repoRoot, "scripts/multipart-encode-smoke.ts"), "utf8");
  const filters = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "benches/path-filters.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.match(workflow, /multipart-smoke-gate/);
  assert.match(smokeGate, /src\/rest\/multipart\.ts/);
  assert.match(smoke, /createTestClient/);
  assert.match(smoke, /payload_json/);
  assert.match(smoke, /files\[0\]/);
  assert.equal("multipart" in filters, false);
  assert.equal("multipart-encode" in filters, false);
  assert.equal(smoke.includes("medianUs"), false);
  assert.equal(smoke.includes("p95Us"), false);
  assert.equal(smokeGate.includes("--dynamic"), false);
});

test("tag release job can attach coverage and publish npm without a Discord token", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8");
  const coverage = fs.readFileSync(path.join(repoRoot, "scripts/static-coverage.mjs"), "utf8");
  assert.match(workflow, /static-coverage\.mjs/);
  assert.match(workflow, /coverage-rest\.txt/);
  assert.match(workflow, /coverage-gateway\.txt/);
  assert.match(workflow, /message-create-smoke/);
  assert.match(workflow, /multipart-smoke-gate/);
  assert.match(workflow, /npm publish/);
  assert.match(coverage, /scriptc/);
  assert.equal(workflow.includes("--dynamic"), false);
  assert.equal(workflow.includes("DISCORD_TOKEN"), false);
  assert.equal(workflow.includes("BOT_TOKEN"), false);
});
