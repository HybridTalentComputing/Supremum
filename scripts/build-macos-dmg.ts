import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TAURI_DIR = resolve(ROOT, "src-tauri");

const target = process.argv[2];

const suffixByTarget: Record<string, string> = {
  "aarch64-apple-darwin": "aarch64",
  "x86_64-apple-darwin": "x64",
  "universal-apple-darwin": "universal",
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(command: string[]) {
  const proc = Bun.spawnSync(command, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode ?? 1);
  }
}

if (!target || !suffixByTarget[target]) {
  fail(
    "Usage: bun scripts/build-macos-dmg.ts <aarch64-apple-darwin|x86_64-apple-darwin|universal-apple-darwin>",
  );
}

const version = JSON.parse(
  readFileSync(resolve(TAURI_DIR, "tauri.conf.json"), "utf8"),
).version as string;

const targetRoot = resolve(TAURI_DIR, "target", target, "release");
const appPath = resolve(targetRoot, "bundle", "macos", "Supremum.app");
const dmgDir = resolve(targetRoot, "bundle", "dmg");
const dmgName = `Supremum_${version}_${suffixByTarget[target]}.dmg`;
const dmgPath = resolve(dmgDir, dmgName);
const collectedDir = resolve(TAURI_DIR, "target", "release-artifacts", version, "macos");
const collectedDmgPath = resolve(collectedDir, dmgName);

run([
  "bun",
  "run",
  "tauri",
  "build",
  "--target",
  target,
  "--bundles",
  "app",
  "--no-sign",
]);

if (!existsSync(appPath)) {
  fail(`Expected app bundle not found: ${appPath}`);
}

run([
  "codesign",
  "--force",
  "--deep",
  "--sign",
  "-",
  "--options",
  "runtime",
  appPath,
]);

run([
  "codesign",
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  appPath,
]);

mkdirSync(dmgDir, { recursive: true });
rmSync(dmgPath, { force: true });

const stagingDir = mkdtempSync(join(tmpdir(), "supremum-dmg-"));
const stagedAppPath = resolve(stagingDir, "Supremum.app");

cpSync(appPath, stagedAppPath, { recursive: true });
symlinkSync("/Applications", resolve(stagingDir, "Applications"));

run([
  "hdiutil",
  "create",
  "-volname",
  "Supremum",
  "-srcfolder",
  stagingDir,
  "-ov",
  "-format",
  "UDZO",
  dmgPath,
]);

mkdirSync(collectedDir, { recursive: true });
copyFileSync(dmgPath, collectedDmgPath);

rmSync(stagingDir, { recursive: true, force: true });

console.log(`Created signed DMG: ${dmgPath}`);
console.log(`Collected release artifact: ${collectedDmgPath}`);
