#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CamoufoxGateway, type BrowserGateway } from "../client/camoufox.js";
import { GreenweezClient } from "../client/greenweez.js";
import { GreenweezError } from "../client/errors.js";
import { ConfirmationStore } from "../client/confirmation-store.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

function error(error: unknown) {
  const known = error instanceof GreenweezError ? error : new GreenweezError("Erreur interne du connecteur.", "internal_error", "Consultez les diagnostics locaux puis réessayez.");
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code: known.code, message: known.message, remediation: known.remediation } }, null, 2) }] };
}

export function createServer(browser: BrowserGateway = new CamoufoxGateway(), confirmations = new ConfirmationStore()): McpServer {
  const client = new GreenweezClient(browser, confirmations);
  const server = new McpServer({ name: "greenweez-mcp", version: "0.2.0" });
  server.registerTool("search_products", {
    title: "Rechercher des produits Greenweez",
    description: "Recherche publique dans le catalogue Greenweez et retourne une page de produits avec les prix observés.",
    inputSchema: { query: z.string().trim().min(2).max(160), page: z.number().int().min(1).max(100).default(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  }, async ({ query, page }) => {
    try { return result(await client.search(query, page)); } catch (cause) { return error(cause); }
  });
  server.registerTool("get_product", {
    title: "Lire une fiche produit Greenweez",
    description: "Lit une fiche produit publique par sa référence et son slug, y compris les informations alimentaires publiées.",
    inputSchema: { reference: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(64), slug: z.string().trim().regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/).max(240) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  }, async ({ reference, slug }) => {
    try { return result(await client.product(reference, slug)); } catch (cause) { return error(cause); }
  });
  server.registerTool("get_cart", {
    title: "Lire le panier Greenweez",
    description: "Relit le panier réel du compte connecté sans demander les adresses, paiements ni données de profil.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  }, async () => {
    try { return result(await client.cart()); } catch (cause) { return error(cause); }
  });
  server.registerTool("preview_add_to_cart", {
    title: "Prévisualiser un ajout au panier",
    description: "Relit la fiche, l’offre, le stock et le panier, puis crée une confirmation à usage unique valable deux minutes. Ne modifie pas le panier.",
    inputSchema: { reference: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(64), slug: z.string().trim().regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/).max(240) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  }, async ({ reference, slug }) => {
    try { return result(await client.previewAddToCart(reference, slug)); } catch (cause) { return error(cause); }
  });
  server.registerTool("confirm_add_to_cart", {
    title: "Confirmer un ajout au panier",
    description: "Consomme une confirmation d’ajout, refuse tout panier modifié entre-temps, ajoute exactement une unité, puis vérifie le panier réel.",
    inputSchema: { confirmationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  }, async ({ confirmationToken }) => {
    try { return result(await client.confirmAddToCart(confirmationToken)); } catch (cause) { return error(cause); }
  });
  server.registerTool("preview_remove_from_cart", {
    title: "Prévisualiser le retrait d’une ligne du panier",
    description: "Relit le panier et crée une confirmation à usage unique pour retirer toute la ligne ciblée. Ne modifie pas le panier.",
    inputSchema: { reference: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(64) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  }, async ({ reference }) => {
    try { return result(await client.previewRemoveFromCart(reference)); } catch (cause) { return error(cause); }
  });
  server.registerTool("confirm_remove_from_cart", {
    title: "Confirmer le retrait d’une ligne du panier",
    description: "Consomme une confirmation de retrait, refuse tout panier modifié entre-temps, retire la ligne ciblée, puis vérifie le panier réel.",
    inputSchema: { confirmationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
  }, async ({ confirmationToken }) => {
    try { return result(await client.confirmRemoveFromCart(confirmationToken)); } catch (cause) { return error(cause); }
  });
  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return false; }
}

if (isMainModule()) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`greenweez-mcp: ${message}\n`);
    process.exitCode = 1;
  });
}
