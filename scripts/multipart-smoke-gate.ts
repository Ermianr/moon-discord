import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scenarioTouched } from "../benches/lib/paths.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MULTIPART_PATHS = [
  "src/rest/multipart.ts",
  "scripts/multipart-encode-smoke.ts",
  "scripts/multipart-smoke-gate.ts",
];

function changedFiles(): string[] {
  if (process.env.HOT_PATH_ALL === "1") {
    return ["src/rest/multipart.ts"];
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

const files = changedFiles();
if (!scenarioTouched(files, MULTIPART_PATHS)) {
  console.log("skip multipart encode smoke: path filter");
} else {
  execFileSync("node", ["--import", "tsx", "scripts/multipart-encode-smoke.ts"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
