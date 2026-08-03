#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type BrowserGateway } from "../client/camoufox.js";
import { ConfirmationStore } from "../client/confirmation-store.js";
import { GreenweezOnboarding } from "../client/onboarding.js";
export declare function createServer(browser?: BrowserGateway, confirmations?: ConfirmationStore, onboarding?: GreenweezOnboarding | undefined): McpServer;
