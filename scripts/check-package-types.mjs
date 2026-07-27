import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "attw.cmd" : "attw";
const environment = { ...process.env };

delete environment.npm_config_dry_run;
delete environment.NPM_CONFIG_DRY_RUN;

const result = spawnSync(
  command,
  [
    "--pack",
    ".",
    "--profile",
    "esm-only",
    "--no-summary",
    "--format",
    "table",
    "--no-emoji",
    "--no-color",
  ],
  {
    env: environment,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

if (result.signal !== null) {
  throw new Error(`attw terminated with signal ${result.signal}`);
}

process.exitCode = result.status ?? 1;
