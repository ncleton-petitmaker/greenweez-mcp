import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrowserGateway } from "../client/camoufox.js";
import { ConfirmationStore } from "../client/confirmation-store.js";
import { GreenweezClient } from "../client/greenweez.js";
import { GreenweezError } from "../client/errors.js";
import { createServer } from "../mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const reference = "2WEEZ0245";
const slug = "pois-chiches-bio-400g-1";

function line(quantity: number) {
  return {
    id: "8123",
    quantity,
    offer: {
      id: "73330",
      quantityAvailable: 20,
      status: "AVAILABLE",
      pricing: { price: 2.49 },
      variant: { code: reference, product: { slug, name: "Pois chiches bio 400g", code: reference, legacyId: 129480, brand: { name: "Greenweez" } } },
    },
  };
}

class CartFixtureBrowser implements BrowserGateway {
  quantity = 0;
  mutateCalls = 0;
  throwAfterApply = false;

  async read(_url: URL, expression: string): Promise<unknown> {
    if (expression.includes("descriptionHeading")) return { reference, name: "Pois chiches bio 400g", brand: "Greenweez", price: "2,49€", unitPrice: "6,23€ / kg", url: `https://www.greenweez.com/produit/${slug}/${reference}`, description: "Pois chiches biologiques prêts à cuisiner.", ingredients: "Pois chiches", allergens: null, nutrition: null, origin: "France", delivery: null };
    if (expression.includes("add_control_missing")) return { ok: true, reference, offerId: 73330, quantityAvailable: 20, inStock: true };
    if (expression.includes("query Cart")) return { ok: true, status: 200, cart: { tokenValue: "cart-token-fixture", totalItems: this.quantity, items: this.quantity ? [line(this.quantity)] : [] } };
    throw new Error("Expression de lecture inconnue dans le fixture.");
  }

  async mutate(_url: URL, expression: string): Promise<unknown> {
    this.mutateCalls += 1;
    if (expression.includes("AddToCart")) this.quantity += 1;
    else if (expression.includes("DeleteCartItems")) this.quantity = 0;
    else throw new Error("Mutation inconnue dans le fixture.");
    if (this.throwAfterApply) throw new Error("Réponse perdue après application");
    return { ok: true, status: 200 };
  }
}

function fixtureClient(browser = new CartFixtureBrowser()) {
  const directory = mkdtempSync(join(tmpdir(), "greenweez-cart-test-"));
  const confirmations = new ConfirmationStore({ GREENWEEZ_SESSION_DIRECTORY: directory });
  const client = new GreenweezClient(browser, confirmations);
  return { browser, client, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("add requires a one-time preview and verifies the real post-state", async () => {
  const { browser, client, cleanup } = fixtureClient();
  try {
    const preview = await client.previewAddToCart(reference, slug);
    assert.equal(browser.quantity, 0);
    assert.equal(preview.quantityAfter, 1);
    const applied = await client.confirmAddToCart(preview.confirmationToken);
    assert.equal(applied.verified, true);
    assert.equal(applied.cart.items[0]?.quantity, 1);
    await assert.rejects(() => client.confirmAddToCart(preview.confirmationToken), (error: unknown) => error instanceof GreenweezError && error.code === "state_conflict");
  } finally { cleanup(); }
});

test("confirmation refuses a cart changed after preview without sending a mutation", async () => {
  const { browser, client, cleanup } = fixtureClient();
  try {
    const preview = await client.previewAddToCart(reference, slug);
    browser.quantity = 2;
    await assert.rejects(() => client.confirmAddToCart(preview.confirmationToken), (error: unknown) => error instanceof GreenweezError && error.code === "state_conflict");
    assert.equal(browser.mutateCalls, 0);
  } finally { cleanup(); }
});

test("an ambiguous transport response is reconciled from the real cart", async () => {
  const browser = new CartFixtureBrowser();
  browser.throwAfterApply = true;
  const { client, cleanup } = fixtureClient(browser);
  try {
    const preview = await client.previewAddToCart(reference, slug);
    const applied = await client.confirmAddToCart(preview.confirmationToken);
    assert.equal(applied.applied, true);
    assert.equal(applied.cart.totalItems, 1);
  } finally { cleanup(); }
});

test("remove preview deletes only the confirmed line and verifies absence", async () => {
  const browser = new CartFixtureBrowser();
  browser.quantity = 3;
  const { client, cleanup } = fixtureClient(browser);
  try {
    const preview = await client.previewRemoveFromCart(reference);
    assert.equal(preview.quantityBefore, 3);
    assert.equal(browser.quantity, 3);
    const applied = await client.confirmRemoveFromCart(preview.confirmationToken);
    assert.equal(applied.cart.totalItems, 0);
    assert.deepEqual(applied.cart.items, []);
  } finally { cleanup(); }
});

test("expired confirmation is rejected and consumed", () => {
  const directory = mkdtempSync(join(tmpdir(), "greenweez-confirmation-test-"));
  try {
    const store = new ConfirmationStore({ GREENWEEZ_SESSION_DIRECTORY: directory });
    const { confirmationToken } = store.create({ kind: "add", stateVersion: "a".repeat(64), reference, slug, offerId: 73330, quantityBefore: 0 }, -1);
    assert.throws(() => store.take(confirmationToken), (error: unknown) => error instanceof GreenweezError && error.code === "state_conflict");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("official MCP SDK executes the two-phase add workflow", async () => {
  const directory = mkdtempSync(join(tmpdir(), "greenweez-mcp-cart-test-"));
  const browser = new CartFixtureBrowser();
  const confirmations = new ConfirmationStore({ GREENWEEZ_SESSION_DIRECTORY: directory });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(browser, confirmations);
  const mcp = new Client({ name: "greenweez-cart-test", version: "0.2.0" });
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const preview = await mcp.callTool({ name: "preview_add_to_cart", arguments: { reference, slug } }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    assert.equal(preview.isError, undefined);
    const previewBody = JSON.parse(preview.content[0]?.text ?? "null") as { confirmationToken: string };
    const confirmed = await mcp.callTool({ name: "confirm_add_to_cart", arguments: { confirmationToken: previewBody.confirmationToken } }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    assert.equal(confirmed.isError, undefined);
    assert.match(confirmed.content[0]?.text ?? "", /"verified": true/);
  } finally {
    await mcp.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
});
