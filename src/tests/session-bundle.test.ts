import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readEncryptedSessionBundle, sessionBundlePaths, writeEncryptedSessionBundle } from "../client/session-bundle.js";

function environment(directory: string): NodeJS.ProcessEnv {
  return { GREENWEEZ_SESSION_DIRECTORY: directory };
}

test("session bundle encrypts cookies and restores them", () => {
  const directory = mkdtempSync(join(tmpdir(), "greenweez-session-test-"));
  try {
    const env = environment(directory);
    writeEncryptedSessionBundle([
      { name: "__Secure-next-auth.session-token", value: "synthetic-secret", domain: ".greenweez.com", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "_analytics", value: "discard-me", domain: ".greenweez.com" },
    ], env);
    const paths = sessionBundlePaths(env);
    assert.doesNotMatch(readFileSync(paths.bundleFile, "utf8"), /synthetic-secret/);
    const restored = readEncryptedSessionBundle(env);
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.value, "synthetic-secret");
    if (process.platform !== "win32") {
      assert.equal(statSync(paths.bundleFile).mode & 0o777, 0o600);
      assert.equal(statSync(paths.keyFile).mode & 0o777, 0o600);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("session bundle fails closed with a different key", () => {
  const directory = mkdtempSync(join(tmpdir(), "greenweez-session-test-"));
  try {
    const env = environment(directory);
    writeEncryptedSessionBundle([{ name: "__Secure-next-auth.session-token", value: "synthetic-secret", domain: "www.greenweez.com" }], env);
    writeFileSync(sessionBundlePaths(env).keyFile, `${"00".repeat(32)}\n`, { mode: 0o600 });
    assert.throws(() => readEncryptedSessionBundle(env), /ne peut pas être déchiffré/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("session bundle paths are isolated by Camoufox user id", () => {
  const directory = mkdtempSync(join(tmpdir(), "greenweez-session-scope-test-"));
  try {
    const first = sessionBundlePaths({ GREENWEEZ_SESSION_DIRECTORY: directory, GREENWEEZ_CAMOFOX_USER_ID: "account-a" });
    const second = sessionBundlePaths({ GREENWEEZ_SESSION_DIRECTORY: directory, GREENWEEZ_CAMOFOX_USER_ID: "account-b" });
    assert.notEqual(first.bundleFile, second.bundleFile);
    assert.notEqual(first.keyFile, second.keyFile);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
