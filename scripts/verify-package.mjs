import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (command, args, cwd) => {
  const environment = {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  delete environment.npm_config_dry_run;
  delete environment.NPM_CONFIG_DRY_RUN;

  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed`,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join("\n"),
    );
  }
  return result.stdout;
};

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "render-handoff-contract-"),
);

try {
  const packOutput = run(
    npm,
    ["pack", "--json", "--pack-destination", temporaryRoot],
    projectRoot,
  );
  const [manifest] = JSON.parse(packOutput);
  assert.ok(manifest?.filename, "npm pack did not return a filename");

  const packedPaths = new Set(
    manifest.files.map((file) => file.path),
  );
  for (const expected of [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "docs/API.md",
    "package.json",
    "src/audit.d.ts",
    "src/audit.js",
    "src/handoff.d.ts",
    "src/handoff.js",
    "src/index.d.ts",
    "src/index.js",
  ]) {
    assert.ok(packedPaths.has(expected), `tarball is missing ${expected}`);
  }
  for (const path of packedPaths) {
    assert.equal(path.startsWith("test/"), false);
    assert.equal(path.startsWith(".github/"), false);
    assert.equal(path.startsWith("scripts/"), false);
  }

  const consumer = join(temporaryRoot, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const tarball = join(temporaryRoot, manifest.filename);
  run(
    npm,
    ["install", "--ignore-scripts", tarball],
    consumer,
  );

  const smokeTest = `
    import * as root from "render-handoff-contract";
    import * as handoff from "render-handoff-contract/handoff";
    import * as audit from "render-handoff-contract/audit";

    if (typeof root.advanceHandoff !== "function") process.exit(1);
    if (typeof handoff.createHandoffState !== "function") process.exit(2);
    if (typeof audit.auditTimeline !== "function") process.exit(3);

    const result = handoff.advanceHandoff(null, {
      timeMs: 0,
      requested: true,
      previousAvailable: true,
      nextPresent: true,
      coverage: 1,
      loadProgress: 1
    }, {
      stableForMs: 0,
      revealDurationMs: 0
    });
    if (result.state.phase !== "active") process.exit(4);
  `;
  const smokePath = join(consumer, "smoke.mjs");
  await writeFile(smokePath, smokeTest);
  run(process.execPath, [smokePath], consumer);

  const installedManifest = JSON.parse(
    await readFile(
      join(
        consumer,
        "node_modules",
        "render-handoff-contract",
        "package.json",
      ),
      "utf8",
    ),
  );
  assert.equal(installedManifest.version, manifest.version);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
