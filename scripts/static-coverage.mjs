import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const contract = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "static-contract.json"), "utf8"),
);

const version = execFileSync("scriptc", ["--version"], {
  encoding: "utf8",
  cwd: repoRoot,
}).trim();
if (version !== contract.compiler) {
  console.error(`scriptc ${version} does not match contract compiler ${contract.compiler}`);
  process.exit(1);
}

if (contract.dynamic !== "forbidden") {
  console.error("static-contract.json must forbid --dynamic");
  process.exit(1);
}

for (const entry of contract.entries) {
  const args = ["coverage", entry.path, "--backend", entry.backend];
  if (args.includes("--dynamic")) {
    console.error("coverage command must not pass --dynamic");
    process.exit(1);
  }
  const output = execFileSync("scriptc", args, {
    encoding: "utf8",
    cwd: repoRoot,
  });
  process.stdout.write(output);
  if (/runs with --dynamic|dynamic island|SC2013/i.test(output)) {
    console.error(`coverage for ${entry.path} is not fully static`);
    process.exit(1);
  }
  if (/^ {2}blockers:/m.test(output)) {
    console.error(`coverage for ${entry.path} has reached static blockers`);
    process.exit(1);
  }
  if (!output.includes("fully static")) {
    console.error(`coverage for ${entry.path} did not report fully static`);
    process.exit(1);
  }
}
