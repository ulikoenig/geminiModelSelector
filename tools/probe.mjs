// Dumps the model picker of the real Gemini page: every <bard-mode-switcher> (the page may have one under the input
// and one in the header, only one of them visible), the picker button, everything that opens next to it (menu,
// panel, bottom sheet) and the submenu of every entry that opens one. Read-only: it opens menus and hovers entries, it
// never selects anything and never sends a message. Use it when Google changes the page and the script stops working.
//
// Usage:  node tools/probe.mjs                          signed out, throw-away profile, 1400x900
//         node tools/probe.mjs --viewport=870x600       a narrow window (the picker moves into the header)
//         node tools/probe.mjs --signed-in              with the profile of "npm run login"
// Output: out/probe-<signed-out|signed-in>[-WxH].txt (git-ignored, may contain account-specific labels)
import fs from 'node:fs';
import path from 'node:path';
import { launchAnonymous, launchSignedIn, outDir, rejectCookieDialog } from './lib.mjs';

// Watchdog: a hung browser must never keep this process alive.
setTimeout(() => {
  console.log('WATCHDOG: overall time limit reached, aborting');
  process.exit(2);
}, 150_000).unref();

const signedIn = process.argv.includes('--signed-in');
const viewportArg = process.argv.find((arg) => arg.startsWith('--viewport='));
const [width, height] = viewportArg ? viewportArg.slice('--viewport='.length).split('x').map(Number) : [1400, 900];
const viewport = { width, height };
const tag = `${signedIn ? 'signed-in' : 'signed-out'}${viewportArg ? `-${width}x${height}` : ''}`;
const dumpFile = path.join(outDir, `probe-${tag}.txt`);
fs.writeFileSync(dumpFile, '');
const dump = (...parts) => fs.appendFileSync(dumpFile, parts.join(' ') + '\n');
const withTimeout = (promise, ms = 8000) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]).catch(() => {});

/** Runs in the page: compact tree of an element (tag, class, role, aria-*, icon names, own text). */
function tree(args) {
  const { selector, index, maxLines } = args;
  const root = document.querySelectorAll(selector)[index || 0];
  if (!root) return `(nothing matches ${selector})`;
  const KEEP = ['role', 'aria-label', 'aria-haspopup', 'aria-expanded', 'aria-checked', 'aria-pressed', 'aria-selected', 'aria-disabled', 'aria-hidden', 'aria-controls', 'data-test-id', 'tabindex', 'fonticon', 'data-mat-icon-name', 'popover', 'hidden', 'id', 'type'];
  const lines = [];
  const walk = (el, depth) => {
    const tag = el.tagName.toLowerCase();
    if (lines.length >= (maxLines || 400) || depth > 22 || tag === 'style' || tag === 'script') return;
    const attrs = [];
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter((c) => c && !/^ng-|^_ng|^cdk-focus|^mat-ripple/.test(c)).join(' ').slice(0, 150);
    if (cls) attrs.push(`class="${cls}"`);
    for (const name of KEEP) if (el.hasAttribute(name)) attrs.push(`${name}="${String(el.getAttribute(name)).slice(0, 80)}"`);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
    lines.push('  '.repeat(depth) + `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${own ? ` "${own.slice(0, 100)}"` : ''}`);
    if (tag !== 'svg') for (const child of el.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
}

/** Runs in the page: every <bard-mode-switcher> with its visibility and buttons (the page may have more than one). */
function switchers() {
  const visible = (el) => el.getClientRects().length > 0;
  return [...document.querySelectorAll('bard-mode-switcher')].map((el, index) => {
    const r = el.getBoundingClientRect();
    return {
      index,
      visible: visible(el),
      rect: [r.x, r.y, r.width, r.height].map(Math.round),
      parents: (() => {
        const out = [];
        for (let e = el.parentElement; e && out.length < 5; e = e.parentElement) out.push(e.tagName.toLowerCase() + '.' + (e.getAttribute('class') || '').split(/\s+/).filter((c) => c && !/^ng-/.test(c)).slice(0, 2).join('.'));
        return out.join(' < ');
      })(),
      buttons: [...el.querySelectorAll('button, [role="button"]')].map((b, i) => ({
        i,
        tag: b.tagName.toLowerCase(),
        testid: b.getAttribute('data-test-id'),
        aria: b.getAttribute('aria-label'),
        haspopup: b.getAttribute('aria-haspopup'),
        expanded: b.getAttribute('aria-expanded'),
        disabled: b.getAttribute('aria-disabled'),
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        visible: visible(b),
      })),
    };
  });
}

/** Runs in the page: everything visible that opens next to the picker: popovers, panes, dialogs, menus, sheets. */
function openThings() {
  const where = (el) => {
    const out = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      out.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + (e.getAttribute('class') || '').split(/\s+/).filter((c) => c && !/^ng-/.test(c)).slice(0, 2).join('.'));
    }
    return out.slice(0, 9).join(' < ');
  };
  const SELECTOR = '[popover], .cdk-overlay-pane, [role="dialog"], [role="menu"], [role="listbox"], [role="radiogroup"], mat-bottom-sheet-container, gem-bottom-sheet, gem-menu';
  return [...document.querySelectorAll(SELECTOR)]
    .filter((el) => el.isConnected && el.getClientRects().length > 0)
    .map((el, i) => ({
      i,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      id: el.id,
      insideSwitcher: Boolean(el.closest('bard-mode-switcher')),
      where: where(el),
      entries: [...el.querySelectorAll('[role^="menuitem"], [role="option"], [role="radio"]')].slice(0, 30).map((e) => ({
        role: e.getAttribute('role'),
        checked: e.getAttribute('aria-checked'),
        disabled: e.getAttribute('aria-disabled'),
        popup: e.getAttribute('aria-haspopup'),
        expanded: e.getAttribute('aria-expanded'),
        lock: Boolean(e.querySelector('[fonticon="lock"], [data-mat-icon-name="lock"]')),
        text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      })),
    }));
}

const { context, close } = signedIn ? { context: await launchSignedIn({ viewport }), close: null } : await launchAnonymous({ viewport });
try {
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(15_000);
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await page.waitForTimeout(2500);
  await rejectCookieDialog(page);
  await page.waitForSelector('bard-mode-switcher', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(3500);

  const all = await page.evaluate(switchers);
  dump(`===== ${all.length} <bard-mode-switcher> element(s), viewport ${width}x${height} =====`);
  dump(JSON.stringify(all, null, 1));
  for (const s of all) {
    dump(`\n===== switcher ${s.index} (${s.visible ? 'visible' : 'HIDDEN'}), closed =====`);
    dump(await page.evaluate(tree, { selector: 'bard-mode-switcher', index: s.index, maxLines: 80 }));
  }

  // The picker a user would click: the first visible button of a visible switcher.
  const target = await page.evaluate(() => {
    for (const switcher of document.querySelectorAll('bard-mode-switcher')) {
      if (!switcher.getClientRects().length) continue;
      const button = [...switcher.querySelectorAll('button, [role="button"]')].find((b) => b.getClientRects().length > 0);
      if (button) {
        button.setAttribute('data-probe-picker', '1');
        return true;
      }
    }
    return false;
  });
  dump(`\nTarget picker found: ${target}`);
  if (!target) throw new Error('no visible picker button');
  await page.screenshot({ path: path.join(outDir, `probe-${tag}-closed.png`) });
  await page.locator('[data-probe-picker]').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, `probe-${tag}-menu.png`) });

  const things = await page.evaluate(openThings);
  dump('\n===== visible panels, menus and sheets after a real click on the picker =====');
  dump(JSON.stringify(things, null, 1));
  for (const thing of things.filter((x) => !things.some((y) => y !== x && x.where.includes(y.where.split(' < ')[0]) && y.where.length < x.where.length))) {
    dump(`\n--- tree of ${thing.tag}${thing.id ? '#' + thing.id : ''} ---`);
    const selector = thing.id ? `#${thing.id}` : thing.tag;
    dump(await page.evaluate(tree, { selector, index: 0, maxLines: 300 }));
  }
  const entries = things.flatMap((x) => x.entries);
  console.log(`probe written: ${dumpFile}`);
  console.log('switchers:', all.map((s) => `#${s.index} ${s.visible ? 'visible' : 'hidden'} buttons=${s.buttons.map((b) => `${b.testid || b.tag}:"${b.text}"${b.visible ? '' : '(hidden)'}`).join(',')}`).join(' | '));
  console.log('open things:', things.map((x) => `${x.tag}${x.role ? '[' + x.role + ']' : ''}${x.insideSwitcher ? '' : ' (outside switcher)'}`).join(' | '));
  console.log('entries:', entries.map((e) => `${e.text}${e.lock ? ' [lock]' : ''}${e.checked === 'true' ? ' *' : ''}${e.popup === 'true' ? ' >' : ''}`).join(' | '));
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
} finally {
  if (close) await close();
  else await withTimeout(context.close());
}
process.exit(0);
