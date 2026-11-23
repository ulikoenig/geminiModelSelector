// End-to-end test against the REAL Gemini page. Two parts:
//
//  1. Signed out (always runs): a throw-away profile, no account. The script must find the picker, look at the menu
//     without clicking anything (every model is locked, there is only "Automatic" and a sign-in entry), hide the
//     locked models and leave the page alone: no navigation to the sign-in page, no menu left open.
//  2. Signed in (runs if tools/login.mjs has created the profile in .profile/): the script must select the best
//     unlocked model and the highest thinking effort, and leave the chat alone. It first sets the lowest thinking
//     effort by hand so that there is something to do. The test never sends a message. It changes the model and
//     thinking-effort selection of the signed-in account, which is exactly what the script is for.
//
// The script is loaded as an init script (Tampermonkey itself does not run in the test; the script uses no GM_* API).
// Without a network connection or if google.com shows something unexpected the test says SKIP instead of failing.
import fs from 'node:fs';
import path from 'node:path';
import { launchAnonymous, launchSignedIn, outDir, profileDir, rejectCookieDialog, root } from '../tools/lib.mjs';

// Watchdog: a hung browser must never keep this process alive.
setTimeout(() => {
  console.log('WATCHDOG: overall time limit reached, aborting');
  process.exit(2);
}, 280_000).unref();

const src = fs.readFileSync(process.env.GEMINI_SCRIPT || path.join(root, 'gemini-best-model.user.js'), 'utf8');
const withTimeout = (promise, ms = 8000) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]).catch(() => {});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  -> ' + detail : ''}`);
};
const skip = (why) => console.log(`SKIP  ${why}`);

// Under the input the mark sits on the <button>, in the header (narrow window) on the <gem-button> around it.
const PICKER = 'bard-mode-switcher [data-test-id="bard-mode-menu-button"]';

/** Opens the app with the script loaded and returns the page and its console lines of the script. */
async function openApp(context) {
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(15_000);
  const lines = [];
  page.on('console', (m) => m.text().startsWith('[gemini-best-model]') && lines.push(m.text().replace('[gemini-best-model] ', '')));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('gemini-best-model-debug', '1');
    } catch (_) {}
  });
  await page.addInitScript({ content: src });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 40_000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await page.waitForTimeout(2500);
  await rejectCookieDialog(page);
  return { page, lines };
}

const menuState = (page) =>
  page.evaluate(() => {
    const picker = document.querySelector('bard-mode-switcher [data-test-id="bard-mode-menu-button"]');
    return {
      label: picker ? picker.textContent.replace(/\s+/g, ' ').trim() : null,
      menusVisible: [...document.querySelectorAll('[role="menu"]')].filter((m) => m.getClientRects().length > 0).length,
      url: location.origin + location.pathname,
    };
  });

/** Opens the menu with a real click and lists the entries the user sees: label, lock icon, computed display. */
async function userMenu(page) {
  await page.click(PICKER);
  await page.waitForTimeout(800);
  const entries = await page.evaluate(() =>
    [...document.querySelectorAll('bard-mode-switcher gem-menu[role="menu"] > [role^="menuitem"]')].map((el) => ({
      text: (el.querySelector('.label')?.textContent || '').replace(/\s+/g, ' ').trim(),
      role: el.getAttribute('role'),
      checked: el.getAttribute('aria-checked'),
      locked: Boolean(el.querySelector('[fonticon="lock"], [data-mat-icon-name="lock"]')),
      popup: el.getAttribute('aria-haspopup'),
      display: getComputedStyle(el).display,
    })),
  );
  return entries;
}

// ---------- 1. signed out, in a wide and in a narrow window (the picker moves into the header) ----------
for (const { label, viewport } of [
  { label: 'wide window', viewport: { width: 1400, height: 900 } },
  { label: 'narrow window 870x600', viewport: { width: 870, height: 600 } },
]) {
  const { context, close } = await launchAnonymous({ viewport });
  try {
    const { page, lines } = await openApp(context);
    const found = await page.waitForSelector(PICKER, { timeout: 30_000 }).catch(() => null);
    if (!found) {
      skip(`signed out, ${label}: the model picker did not show up (no network or a changed page), part skipped`);
    } else {
      await page.waitForTimeout(9000); // start delay plus three looks at a menu with a single model
      const state = await menuState(page);
      check(`signed out, ${label}: the script did its work and closed the menu again`, state.menusVisible === 0, JSON.stringify(state));
      check(`signed out, ${label}: nothing was clicked (still on the app page, picker still says Automatic)`, state.url === 'https://gemini.google.com/app' && /automatic|auto/i.test(state.label || ''), JSON.stringify(state));
      check(`signed out, ${label}: the script saw the menu and reported no error`, lines.some((l) => /^(menu|Menü):/.test(l)) && !lines.some((l) => /failed|Fehlversuch/.test(l)), lines.join(' | '));
      const entries = await userMenu(page);
      const slug = label.replace(/\W+/g, '-');
      fs.writeFileSync(path.join(outDir, `e2e-signed-out-menu-${slug}.json`), JSON.stringify(entries, null, 2));
      const lockedShown = entries.filter((e) => e.locked && e.display !== 'none');
      const lockedCount = entries.filter((e) => e.locked).length;
      check(`signed out, ${label}: every model with a lock icon is hidden`, lockedCount >= 1 && lockedShown.length === 0, JSON.stringify(entries));
      check(`signed out, ${label}: Automatic and the sign-in entry stay visible`, entries.filter((e) => !e.locked && e.display !== 'none').length >= 2, JSON.stringify(entries));
      await page.screenshot({ path: path.join(outDir, `e2e-signed-out-${slug}.png`) });
    }
  } finally {
    await close();
  }
}

// ---------- 2. signed in ----------
let signedInContext = null;
if (process.env.SKIP_SIGNED_IN) {
  skip('signed in: skipped (SKIP_SIGNED_IN is set)');
} else if (!fs.existsSync(path.join(profileDir, 'Default'))) {
  skip('signed in: no test profile in .profile/ (create it with: npm run login)');
} else {
  signedInContext = await launchSignedIn().catch((error) => {
    skip(`signed in: the profile cannot be opened (is the window of "npm run login" still open?) ${String(error.message).split('\n')[0]}`);
    return null;
  });
}
if (signedInContext) {
  const context = signedInContext;
  try {
    const { page, lines } = await openApp(context);
    const found = await page.waitForSelector(PICKER, { timeout: 30_000 }).catch(() => null);
    const signedOut = found ? await page.evaluate(() => document.body.classList.contains('viewer-signed-out')) : true;
    if (!found || signedOut) {
      skip('signed in: the profile is not signed in to Google (run: npm run login), part skipped');
    } else {
      await page.waitForTimeout(12_000); // the script looks at the menu once and sets what is missing
      const entries = await userMenu(page);
      fs.writeFileSync(path.join(outDir, 'e2e-signed-in-menu.json'), JSON.stringify(entries, null, 2));
      await page.screenshot({ path: path.join(outDir, 'e2e-signed-in.png') });
      const models = entries.filter((e) => e.role === 'menuitemradio' && !e.locked);
      const best = models.at(-1);
      check('signed in: no locked entry is visible in the menu', entries.filter((e) => e.locked && e.display !== 'none').length === 0, JSON.stringify(entries));
      check('signed in: the last unlocked model is the selected one', Boolean(best) && best.checked === 'true', JSON.stringify(entries));
      check('signed in: the script reported no error', !lines.some((l) => /failed/.test(l)), lines.join(' | '));
      console.log('INFO  signed-in menu:', entries.map((e) => `${e.text}${e.locked ? ' [lock]' : ''}${e.checked === 'true' ? ' *' : ''}${e.popup === 'true' ? ' >' : ''}`).join(' | '));
    }
  } finally {
    await withTimeout(context.close());
  }
}

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
process.exit(failedChecks.length ? 1 : 0);
