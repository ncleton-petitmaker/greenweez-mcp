import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserGateway } from "../client/camoufox.js";
import { GreenweezClient } from "../client/greenweez.js";
import { GreenweezOnboarding, type GreenweezOnboardingGateway } from "../client/onboarding.js";
import { createServer } from "../mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

class FixtureBrowser implements BrowserGateway {
  seen: URL[] = [];
  async read(url: URL, expression: string): Promise<unknown> {
    this.seen.push(url);
    if (expression.includes("main article")) return { query: "pâte à tartiner", total: 2, products: [{ reference: "2WEEZ0443", name: "Pâte à tartiner noisettes et cacao Bio 600g", brand: "Greenweez", price: "5,95€", unitPrice: "9,92€ / Kg", url: "https://www.greenweez.com/produit/pate-a-tartiner-noisettes-et-cacao-bio-600g/2WEEZ0443" }] };
    return { reference: "2WEEZ0443", name: "Pâte à tartiner noisettes et cacao Bio 600g", brand: "Greenweez", price: "5,95€", unitPrice: "9,92€/kg", url: "https://www.greenweez.com/produit/pate-a-tartiner-noisettes-et-cacao-bio-600g/2WEEZ0443", description: "Description publique", ingredients: "Sucre", allergens: "noisettes", nutrition: "Energie", origin: "UE / non UE", delivery: "2-3 jours" };
  }
  async mutate(url: URL, expression: string): Promise<unknown> {
    return this.read(url, expression);
  }
}

class FixtureOnboarding implements GreenweezOnboardingGateway {
  connected = false;
  loginCalls = 0;
  accountCreationCalls = 0;

  async sessionStatus() { return { connected: this.connected, portableBundle: this.connected }; }
  async loginAndExportSession() { this.loginCalls += 1; this.connected = true; return { connected: true as const, exported: true as const }; }
  async openAccountCreation() { this.accountCreationCalls += 1; return { opened: true as const }; }
}

test("search uses the observed public search route", async () => {
  const browser = new FixtureBrowser();
  const response = await new GreenweezClient(browser).search("pâte à tartiner", 2);
  assert.equal(browser.seen[0]?.pathname, "/recherche/p%C3%A2te%20%C3%A0%20tartiner");
  assert.equal(browser.seen[0]?.search, "?page=2");
  assert.equal(response.products[0]?.reference, "2WEEZ0443");
});

test("product uses the observed public product route", async () => {
  const browser = new FixtureBrowser();
  const response = await new GreenweezClient(browser).product("2WEEZ0443", "pate-a-tartiner-noisettes-et-cacao-bio-600g");
  assert.equal(browser.seen[0]?.pathname, "/produit/pate-a-tartiner-noisettes-et-cacao-bio-600g/2WEEZ0443");
  assert.equal(response.ingredients, "Sucre");
});

test("MCP SDK exposes read-only product search", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(new FixtureBrowser());
  const client = new Client({ name: "greenweez-mcp-test", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ["confirm_add_to_cart", "confirm_remove_from_cart", "connect_greenweez", "get_cart", "get_product", "preview_add_to_cart", "preview_remove_from_cart", "search_products"]);
  assert.equal(tools.tools.find((tool) => tool.name === "search_products")?.annotations?.readOnlyHint, true);
  assert.equal(tools.tools.find((tool) => tool.name === "confirm_add_to_cart")?.annotations?.destructiveHint, false);
  assert.equal(tools.tools.find((tool) => tool.name === "confirm_remove_from_cart")?.annotations?.destructiveHint, true);
  const prompts = await client.listPrompts();
  assert.deepEqual(prompts.prompts.map((prompt) => prompt.name), ["onboard_greenweez"]);
  const response = await client.callTool({ name: "search_products", arguments: { query: "pâte à tartiner" } }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  assert.equal(response.isError, undefined);
  assert.match(response.content[0]?.text ?? "", /2WEEZ0443/);
  await client.close();
  await server.close();
});

test("MCP connection tool returns a loopback wizard with both account paths", async () => {
  const fixture = new FixtureOnboarding();
  const onboarding = new GreenweezOnboarding(fixture);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(new FixtureBrowser(), undefined, onboarding);
  const client = new Client({ name: "greenweez-mcp-onboarding-test", version: "0.1.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "connect_greenweez", arguments: {} }) as { isError?: boolean; structuredContent?: { wizardUrl?: string; links?: { signIn: string; createAccount: string }; officialLinks?: { signIn: string; createAccount: string } } };
    assert.equal(response.isError, undefined);
    assert.match(response.structuredContent?.wizardUrl ?? "", /^http:\/\/127\.0\.0\.1:/);
    assert.match(response.structuredContent?.links?.signIn ?? "", /\/connect$/);
    assert.match(response.structuredContent?.links?.createAccount ?? "", /\/create-account$/);
    assert.equal(response.structuredContent?.officialLinks?.signIn, "https://www.greenweez.com/connexion");
    assert.equal(response.structuredContent?.officialLinks?.createAccount, "https://www.greenweez.com/inscription");
  } finally {
    await onboarding.close();
    await client.close();
    await server.close();
  }
});
