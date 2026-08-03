import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const skipped = new Set(["node_modules", "dist", ".git", "ovs-mcp", "skills"]);
const forbidden = [
    /set-cookie\s*:/i,
    /authorization:\s*bearer\s+(?!\$\{this\.apiKey\})/i,
    /greenweez_camoufox_api_key\s*=\s*[^\s]/i,
    /password\s*[:=]\s*['"][^'"]+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
];
async function files(root) {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory())
            return skipped.has(entry.name) ? [] : files(path);
        return [path];
    }));
    return nested.flat();
}
const root = process.cwd();
const matches = [];
for (const file of await files(root)) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (forbidden.some((pattern) => pattern.test(text)))
        matches.push(file);
}
if (matches.length)
    throw new Error(`Audit de confidentialité échoué : ${matches.join(", ")}`);
process.stdout.write("Audit de confidentialité réussi.\n");
