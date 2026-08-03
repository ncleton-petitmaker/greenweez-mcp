#!/usr/bin/env node
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = process.env.GITHUB_REF_NAME || process.argv[2];

if (!tag) {
  process.stdout.write(`Version prête pour une release : v${packageJson.version}.\n`);
  process.exit(0);
}

if (tag !== `v${packageJson.version}`) {
  process.stderr.write(`Le tag ${tag} ne correspond pas à package.json (${packageJson.version}).\n`);
  process.exit(1);
}

process.stdout.write(`Tag ${tag} et package.json cohérents.\n`);
