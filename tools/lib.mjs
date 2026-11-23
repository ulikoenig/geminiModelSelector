// Shared helpers for probes and tests: Edge launchers and the cookie dialog of google.com.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { browserChannel, outDir, profileDir, root, stateFile } from './paths.mjs';

export { outDir, profileDir, root, stateFile };
fs.mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 1400, height: 900 };

/** The browser with the signed-in test profile (.profile/, created by tools/login.mjs). */
export function launchSignedIn({ headless = true, viewport = VIEWPORT } = {}) {
  return chromium.launchPersistentContext(profileDir, { channel: browserChannel, headless, locale: 'de-DE', viewport });
}

/** A browser with a throw-away profile (not signed in). Returns { context, close }; close() also deletes the profile. */
export async function launchAnonymous({ headless = true, viewport = VIEWPORT } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-anon-'));
  const context = await chromium.launchPersistentContext(dir, { channel: browserChannel, headless, locale: 'de-DE', viewport });
  const close = async () => {
    await Promise.race([context.close(), new Promise((resolve) => setTimeout(resolve, 8000))]).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { context, close };
}

/** Rejects the cookie dialog that google.com shows to fresh profiles in the EU. Returns whether there was one. */
export async function rejectCookieDialog(page, { timeoutMs = 6000 } = {}) {
  const button = page.locator('button:has-text("Alle ablehnen"), button:has-text("Reject all")').first();
  const end = Date.now() + timeoutMs;
  do {
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }
    await page.waitForTimeout(300);
  } while (Date.now() < end);
  return false;
}
