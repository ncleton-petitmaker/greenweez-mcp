#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (packed.status !== 0) {
  process.stderr.write(packed.stderr || packed.stdout || "npm pack a échoué.\n");
  process.exit(packed.status ?? 1);
}

const report = JSON.parse(packed.stdout)[0];
const files = report.files.map((file) => file.path);
const forbidden = files.filter((file) =>
  /(^|\/)(?:maintenance|tests|skills|captures|private)(?:$|\/)|\.(?:har|mitm|mobileconfig|pem|key|p12)$/i.test(file) || /^src\//.test(file),
);

if (forbidden.length) {
  process.stderr.write(`Le paquet contient des fichiers interdits :\n${forbidden.join("\n")}\n`);
  process.exit(1);
}

for (const required of ["dist/mcp/server.js", "dist/cli.js", "README.md", "SECURITY.md", "LICENSE"]) {
  if (!files.includes(required)) {
    process.stderr.write(`Le paquet ne contient pas ${required}.\n`);
    process.exit(1);
  }
}

process.stdout.write(`Paquet vérifié : ${files.length} fichiers, ${report.size} octets.\n`);
