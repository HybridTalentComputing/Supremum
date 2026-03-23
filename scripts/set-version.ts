import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PACKAGE_JSON = resolve(ROOT, "package.json");
const CARGO_TOML = resolve(ROOT, "src-tauri", "Cargo.toml");
const TAURI_CONF = resolve(ROOT, "src-tauri", "tauri.conf.json");

const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readJsonFile(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonFile(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function updateCargoVersion(contents: string, version: string) {
  const versionLinePattern = /^version\s*=\s*"[^"]+"$/m;
  if (!versionLinePattern.test(contents)) {
    fail(`Failed to update version in ${CARGO_TOML}`);
  }

  return contents.replace(versionLinePattern, `version = "${version}"`);
}

function run() {
  const version = process.argv[2]?.trim();

  if (!version) {
    fail("Usage: bun run version <version>");
  }

  if (!VERSION_PATTERN.test(version)) {
    fail(`Invalid version: ${version}`);
  }

  const packageJson = readJsonFile(PACKAGE_JSON);
  packageJson.version = version;
  writeJsonFile(PACKAGE_JSON, packageJson);

  const tauriConfig = readJsonFile(TAURI_CONF);
  tauriConfig.version = version;
  writeJsonFile(TAURI_CONF, tauriConfig);

  const cargoToml = readFileSync(CARGO_TOML, "utf8");
  writeFileSync(CARGO_TOML, updateCargoVersion(cargoToml, version));

  console.log(`Updated project version to ${version}`);
}

run();
