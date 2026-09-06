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

test("static-contract.json names the REST LLVM lane without --dynamic", () => {
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
      backend: string;
    }>;
  };

  assert.equal(contract.compiler, "0.0.36");
  assert.equal(contract.dynamic, "forbidden");
  assert.deepEqual(contract.npmStatic, ["moon-discord"]);
  assert.equal(contract.platform, "linux-x86_64-glibc");
  assert.equal(contract.entries.length, 1);
  const restEntry = contract.entries[0];
  assert.ok(restEntry !== undefined);
  assert.equal(restEntry.name, "rest");
  assert.equal(restEntry.path, "representatives/rest.ts");
  assert.equal(restEntry.import, "moon-discord/rest");
  assert.equal(restEntry.backend, "llvm");

  const source = fs.readFileSync(path.join(repoRoot, restEntry.path), "utf8");
  assert.match(source, /from "\.\.\/src\/rest\.js"/);
  assert.equal(source.includes("--dynamic"), false);
  assert.equal(source.includes("process.env"), false);
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

test("CHANGELOG has a 0.1.0 Keep a Changelog section", () => {
  const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /^## \[0\.1\.0\]/m);
  assert.match(changelog, /Keep a Changelog/);
});

test("PR CI typechecks, tests, and covers the REST entry without a Discord token", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/pr.yml"), "utf8");
  const coverage = fs.readFileSync(path.join(repoRoot, "scripts/static-coverage.mjs"), "utf8");
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /static-coverage\.mjs/);
  assert.match(coverage, /scriptc/);
  assert.match(coverage, /--backend/);
  assert.equal(workflow.includes("--dynamic"), false);
  assert.equal(workflow.includes("DISCORD_TOKEN"), false);
  assert.equal(workflow.includes("BOT_TOKEN"), false);
});

test("tag release job can attach coverage and publish npm without a Discord token", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8");
  const coverage = fs.readFileSync(path.join(repoRoot, "scripts/static-coverage.mjs"), "utf8");
  assert.match(workflow, /static-coverage\.mjs/);
  assert.match(workflow, /npm publish/);
  assert.match(coverage, /scriptc/);
  assert.equal(workflow.includes("--dynamic"), false);
  assert.equal(workflow.includes("DISCORD_TOKEN"), false);
  assert.equal(workflow.includes("BOT_TOKEN"), false);
});
