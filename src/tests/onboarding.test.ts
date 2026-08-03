import assert from "node:assert/strict";
import test from "node:test";
import { GREENWEEZ_LOGIN_URL, GREENWEEZ_SIGNUP_URL, GreenweezOnboarding, type GreenweezOnboardingGateway } from "../client/onboarding.js";

class FakeGateway implements GreenweezOnboardingGateway {
  connected = false;
  loginCalls = 0;
  accountCreationCalls = 0;

  async sessionStatus() { return { connected: this.connected, portableBundle: this.connected }; }
  async loginAndExportSession() { this.loginCalls += 1; this.connected = true; return { connected: true as const, exported: true as const }; }
  async openAccountCreation() { this.accountCreationCalls += 1; return { opened: true as const }; }
}

test("onboarding wizard uses a temporary loopback address and exposes both paths", async () => {
  const gateway = new FakeGateway();
  const onboarding = new GreenweezOnboarding(gateway);
  try {
    const wizard = await onboarding.begin();
    assert.equal(wizard.status, "connection_required");
    assert.match(wizard.wizardUrl ?? "", /^http:\/\/127\.0\.0\.1:/);
    assert.equal(wizard.officialLinks.signIn, GREENWEEZ_LOGIN_URL);
    assert.equal(wizard.officialLinks.createAccount, GREENWEEZ_SIGNUP_URL);
    assert.ok(wizard.links);

    const page = await fetch(wizard.wizardUrl ?? "").then((response) => response.text());
    assert.match(page, /J’ai un compte — me connecter/);
    assert.match(page, /Créer un compte Greenweez/);

    const createResponse = await fetch(wizard.links?.createAccount ?? "", { redirect: "manual" });
    assert.equal(createResponse.status, 302);
    assert.equal(gateway.accountCreationCalls, 1);

    const connectResponse = await fetch(wizard.links?.signIn ?? "", { redirect: "manual" });
    assert.equal(connectResponse.status, 302);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = await fetch(`${wizard.wizardUrl}/status`).then((response) => response.json()) as { state: string };
    assert.equal(gateway.loginCalls, 1);
    assert.equal(status.state, "connected");
  } finally {
    await onboarding.close();
  }
});

test("onboarding reports an already verified session without opening a wizard", async () => {
  const gateway = new FakeGateway();
  gateway.connected = true;
  const onboarding = new GreenweezOnboarding(gateway);
  try {
    const wizard = await onboarding.begin();
    assert.equal(wizard.status, "connected");
    assert.equal(wizard.wizardUrl, undefined);
    assert.equal(wizard.links, undefined);
  } finally {
    await onboarding.close();
  }
});
