// Tests without a Google account on a mock page that reproduces the model picker of the Gemini web app as it was
// measured on the real page: <bard-mode-switcher> with the picker button, the menu as <gem-menu role="menu"> inside a
// top-layer popover, <gem-menu-item> entries with role, aria-checked, aria-disabled and a lock icon, plus a
// thinking-effort submenu. The mock mimics what the script depends on: focus moves into the menu and returns to the
// picker when it closes, Escape closes one level, a disabled entry swallows the click. Query parameters steer the
// scenario:
//   tier=anon|pro|extra      signed out (every model locked, "Anmelden" entry), all unlocked, a new model at the bottom
//   model=n|h|auto           model selected at the start (default auto); effort=low|mid|high (default low)
//   lastLocked=1             the highest thinking effort is locked (lock icon, aria-disabled)
//   lastDisabled=1           the highest thinking effort is disabled without a lock
//   noeffort=1               no thinking-effort entry at all
//   levelsLocked=1           every thinking effort is locked (nothing to choose in the submenu)
//   sub=hover|click|key|none how the thinking-effort entry opens its submenu (default: all three work; none: never)
//   sub=inline               the thinking-effort entry is an expandable entry: its options sit inside the entry
//   flyout=body              the submenu is rendered outside <bard-mode-switcher>
//   resetEffort=1            the page resets the effort to low whenever a model is chosen
//   newChatResetsEffort=1    the page resets the effort to low when a new chat is opened (window.__newChat())
//   reset=1                  the page resets the model to Automatic 400 ms after every model choice
//   nomenu=1                 the picker does nothing (the menu never opens)
//   delay=<ms>               the menu opens only after this delay
//   nofocus=1                nothing has the keyboard focus at the start (default: the chat input has it)
//   layout=header            narrow window: the picker sits in the header ("Gemini Neon"), the test id is on a <gem-button>
//                            around the <button>, and the <button> has no aria-haspopup / aria-expanded
//   view=table               the picker opens "The Periodic Table of Gemini" (a panel, no role="menu") until the page's
//                            "List view" switch is pressed; nolist=1 leaves that switch out
//   gbm-debug, gbm-debug=off not a mock parameter but the script's own switch for its on-screen log panel (see the
//                            "panel" scenarios); a scenario's debugFlag sets what the debug setting holds at the start
// ONLY=<regex> runs only the scenarios whose name matches; VERBOSE=1 prints state and script log for passed checks.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { root } from '../tools/paths.mjs';

// Watchdog: a hung browser must never keep this process alive.
setTimeout(() => {
  console.log('WATCHDOG: overall time limit reached, aborting');
  process.exit(2);
}, 280_000).unref();

const src = fs.readFileSync(process.env.GEMINI_SCRIPT || path.join(root, 'gemini-best-model.user.js'), 'utf8');
const withTimeout = (promise, ms = 8000) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]).catch(() => {});
const results = [];
// The detail (state and script log) is only printed for failed checks; VERBOSE=1 prints it for all of them.
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && (!ok || process.env.VERBOSE) ? '  -> ' + detail : ''}`);
};

/** Runs inside the page. */
function mockMain() {
  const Q = window.Q;
  window.__selected = []; // what was chosen: 'model:<label>' / 'effort:<label>'
  window.__opens = 0; // how often the model menu was opened
  window.__openTimes = [];
  window.__flyoutOpens = 0;
  window.__disabledClicks = 0; // clicks on a locked or disabled entry (the script must never make them)
  window.__signInClicks = 0;
  window.__esc = 0; // Escape key presses that reach the chat input
  window.__opacity = []; // opacity of every popover when it is first painted
  window.__lastKey = 0;
  window.__tableOpens = 0; // how often the periodic-table panel was opened
  window.__panelClicks = 0; // clicks on anything in that panel except the "List view" switch (the script must make none)
  window.__viewSwitches = 0; // presses of the "List view" switch

  const MODELS = [
    { id: 'auto', label: 'Automatic', sub: 'Passt sich an dich an', pill: 'Automatic' },
    { id: 'h', label: 'Hilfe im Alltag', sub: '4 Hydrogen', pill: 'Hydrogen' },
    { id: 'n', label: 'Detaillierte Analyse', sub: '4 Neon', pill: 'Neon', badge: 'Neu' },
    { id: 'c', label: 'Code und komplexe Aufgaben', sub: '4 Carbon', pill: 'Carbon', locked: true },
  ];
  if (Q.tier === 'anon') MODELS.slice(1).forEach((m) => (m.locked = true));
  if (Q.tier === 'pro') MODELS.forEach((m) => (m.locked = false));
  if (Q.tier === 'extra') MODELS.push({ id: 'x', label: 'Zukünftiges Modell', sub: '5 Argon', pill: 'Argon' });
  const LEVELS = [
    { id: 'low', label: 'Niedrig', sub: 'Schnell und effizient', locked: Q.levelsLocked === '1' },
    { id: 'mid', label: 'Mittel', sub: 'Ausgewogener Tiefgang', locked: Q.levelsLocked === '1' },
    { id: 'high', label: 'Hoch', sub: 'Besonders gründlich', locked: Q.levelsLocked === '1' || Q.lastLocked === '1', disabled: Q.lastDisabled === '1' },
  ];
  let model = Q.model || 'auto';
  let effort = Q.effort || 'low';
  window.__model = () => model;
  window.__effort = () => effort;
  const hasEffort = (id) => Q.noeffort !== '1' && id !== 'auto' && Q.tier !== 'anon';

  const picker = document.getElementById('picker');
  // Narrow window: the picker sits in the header, the mark is on the <gem-button> that wraps the <button>, and the
  // <button> has neither aria-haspopup nor aria-expanded (measured on the real page at 870x600).
  const headerLayout = Q.layout === 'header';
  const setExpanded = (value) => {
    if (!headerLayout) picker.setAttribute('aria-expanded', value);
  };
  const switcher = document.querySelector('.pill-ui-logo-container');
  const input = document.getElementById('input');
  let mainPop = null;
  let flyPop = null;
  let trigger = null;
  let opening = false;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) if (value !== undefined && value !== null) el.setAttribute(key, String(value));
    el.append(...kids.filter(Boolean));
    return el;
  }
  const icon = (name, label) =>
    h('gem-icon', label ? { 'aria-label': label } : {}, h('mat-icon', { class: 'mat-icon', role: 'img', 'aria-hidden': 'true', fonticon: name, 'data-mat-icon-name': name, 'data-mat-icon-type': 'font' }));

  /** Same structure as the real <gem-menu-item> (see tools/probe.mjs). */
  function menuItem(o) {
    const el = h('gem-menu-item', {
      role: o.role,
      tabindex: o.checked ? '0' : '-1',
      'data-active': o.checked ? 'true' : 'false',
      'aria-haspopup': o.popup ? 'true' : 'false',
      'aria-disabled': o.disabled ? 'true' : 'false',
      'data-test-id': o.testid,
    });
    if (o.role === 'menuitemradio') el.setAttribute('aria-checked', String(Boolean(o.checked)));
    if (o.popup) {
      el.setAttribute('aria-expanded', 'false');
      el.setAttribute('aria-controls', o.controls);
    }
    if (o.checked) el.className = 'selected active';
    const leading = h('div', { class: 'leading-container' });
    if (o.locked) leading.append(icon('lock'));
    else if (o.checked) leading.append(icon('check', 'Ausgewählt'));
    const labels = h('div', { class: 'label-container' }, h('span', { class: 'label' }, ' ' + o.label + ' '), o.sub ? h('div', { class: 'sublabel' }, o.sub) : null);
    const trailing = h('div', { class: 'trailing-container' }, o.badge ? h('div', { class: 'badge trailing-badge' }, o.badge) : null);
    el.append(h('gem-menu-item-content', { class: (o.checked ? 'selected ' : '') + (o.disabled ? 'disabled ' : '') + 'checkmark-only' }, leading, labels, trailing));
    el.addEventListener('click', (event) => {
      if (o.disabled) {
        window.__disabledClicks++; // like the real page, a disabled entry swallows the click
        event.stopImmediatePropagation();
        return;
      }
      if (o.onclick) o.onclick(event);
    });
    el.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !o.disabled) {
        event.preventDefault();
        el.click();
      }
    });
    return el;
  }

  function popover(menu, parent, left) {
    const pop = h('div', { class: 'cdk-overlay-popover cdk-overlay-connected-position-bounding-box', popover: 'manual' },
      h('div', { class: 'cdk-overlay-pane' }, h('div', { class: 'container' }, h('div', { class: 'popover-menu' }, menu))));
    pop.style.left = left + 'px';
    pop.style.top = '90px';
    parent.appendChild(pop);
    pop.showPopover();
    // Measured in a microtask: after the MutationObserver callbacks of the script (queued earlier) have run and before
    // the browser paints, i.e. what the user would see of the new popover.
    queueMicrotask(() => window.__opacity.push(getComputedStyle(pop).opacity));
    return pop;
  }

  function updatePill() {
    const m = MODELS.find((x) => x.id === model);
    const level = LEVELS.find((l) => l.id === effort);
    document.getElementById('pl').textContent = m.pill;
    // Like the real page ("Neon Hoch"): the thinking effort is part of the picker label unless it is the lowest one.
    document.getElementById('pe').textContent = hasEffort(model) && !m.locked && effort !== 'low' ? ' ' + level.label : '';
    picker.setAttribute('aria-label', 'Modusauswahl öffnen, derzeit ausgewählt: ' + m.pill);
  }

  function closeFlyout() {
    if (!flyPop) return;
    flyPop.remove();
    flyPop = null;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }
  function closeAll() {
    if (flyPop) {
      flyPop.remove();
      flyPop = null;
    }
    if (mainPop) {
      mainPop.remove();
      mainPop = null;
    }
    setExpanded('false');
    picker.focus(); // like the real page: the focus returns to the picker
  }

  function chooseModel(m) {
    window.__selected.push('model:' + m.label);
    model = m.id;
    if (Q.resetEffort === '1') effort = 'low';
    updatePill();
    closeAll();
    if (Q.reset === '1') setTimeout(() => { model = 'auto'; updatePill(); }, 400);
  }
  function chooseLevel(l) {
    window.__selected.push('effort:' + l.label);
    effort = l.id;
    updatePill();
    closeAll();
  }

  function openFlyout() {
    if (flyPop || !mainPop) return;
    window.__flyoutOpens++;
    trigger.setAttribute('aria-expanded', 'true');
    const menu = h('gem-menu', { role: 'menu', id: 'ng-menu-effort', tabindex: '-1', 'data-test-id': 'thinking-level-menu' });
    for (const l of LEVELS) {
      menu.append(menuItem({ role: 'menuitemradio', label: l.label, sub: l.sub, checked: l.id === effort, disabled: l.locked || l.disabled, locked: l.locked, onclick: () => chooseLevel(l) }));
    }
    flyPop = popover(menu, Q.flyout === 'body' ? document.body : switcher, 330);
    (menu.querySelector('.active') || menu.firstElementChild).focus();
  }

  function openMenu() {
    window.__opens++;
    window.__openTimes.push(performance.now());
    const menu = h('gem-menu', { role: 'menu', 'aria-disabled': 'false', 'data-test-id': 'gem-mode-menu', tabindex: '-1', id: 'ng-menu-main' });
    for (const m of MODELS) {
      menu.append(menuItem({ role: 'menuitemradio', label: m.label, sub: m.sub, checked: m.id === model, disabled: m.locked, locked: m.locked, badge: m.badge, testid: 'bard-mode-option-' + (m.locked ? '' : m.id), onclick: () => chooseModel(m) }));
    }
    if (Q.tier === 'anon') {
      menu.append(menuItem({ role: 'menuitem', label: 'Anmelden', sub: 'Erweiterten Zugriff erhalten', testid: 'mode-picker-sign-in-button', onclick: () => window.__signInClicks++ }));
    } else if (hasEffort(model)) {
      menu.append(h('hr', { role: 'separator' }));
      if (Q.sub === 'inline') {
        // An expandable entry: aria-expanded toggles, the options sit INSIDE the entry (no second menu).
        trigger = menuItem({ role: 'menuitem', label: 'Denkaufwand', testid: 'thinking-level-trigger' });
        trigger.setAttribute('aria-expanded', 'false');
        const content = h('div', { class: 'expand-content' });
        content.style.display = 'none';
        for (const l of LEVELS) {
          content.append(menuItem({ role: 'menuitemradio', label: l.label, sub: l.sub, checked: l.id === effort, disabled: l.locked || l.disabled, locked: l.locked, onclick: () => chooseLevel(l) }));
        }
        trigger.append(content);
        trigger.addEventListener('click', (event) => {
          if (event.target.closest('.expand-content')) return; // a click on an option is the option's business
          const open = trigger.getAttribute('aria-expanded') !== 'true';
          trigger.setAttribute('aria-expanded', String(open));
          content.style.display = open ? '' : 'none';
        });
      } else {
        trigger = menuItem({ role: 'menuitem', label: 'Denkaufwand', popup: true, controls: 'ng-menu-effort', testid: 'thinking-level-trigger' });
        const sub = Q.sub || 'any';
        if (sub === 'any' || sub === 'hover') trigger.addEventListener('mouseover', () => setTimeout(openFlyout, 120));
        if (sub === 'any' || sub === 'click') trigger.addEventListener('click', () => (flyPop ? closeFlyout() : openFlyout()));
        if (sub === 'any' || sub === 'key') trigger.addEventListener('keydown', (event) => { if (event.key === 'ArrowRight') openFlyout(); });
      }
      menu.append(trigger);
    }
    mainPop = popover(menu, switcher, 20);
    setExpanded('true');
    (menu.querySelector('.active') || menu).focus();
  }

  let view = Q.view === 'table' ? 'table' : 'list'; // the page remembers the view the user (or the script) pressed

  /** "The Periodic Table of Gemini": a panel with two view switches and a tile per model; no role="menu" in it. */
  function openTable() {
    window.__tableOpens++;
    const toggle = (label, pressed, onclick) => {
      const button = h('button', { type: 'button', class: 'view-toggle', 'aria-pressed': String(pressed) }, h('span', {}, label));
      button.addEventListener('click', onclick);
      return button;
    };
    const count = () => window.__panelClicks++;
    const tile = (symbol, locked) => {
      const button = h('button', { type: 'button', class: 'element-tile' + (locked ? ' locked' : ''), 'aria-label': symbol }, symbol);
      button.addEventListener('click', count);
      return button;
    };
    const unlock = h('button', { type: 'button', class: 'unlock' }, 'Unlock Carbon');
    unlock.addEventListener('click', count);
    const header = h('div', { class: 'panel-header' },
      h('span', { class: 'panel-title' }, 'The Periodic Table of Gemini'),
      toggle('Full table', true, count),
      Q.nolist === '1' ? null : toggle('List view', false, () => { window.__viewSwitches++; view = 'list'; closeAll(); openMenu(); }));
    const panel = h('div', { class: 'periodic-panel' }, header,
      h('div', { class: 'grid' }, tile('H'), tile('He'), tile('C', true), tile('Ne')),
      h('div', { class: 'detail' }, h('span', {}, 'Carbon'), unlock));
    mainPop = popover(panel, switcher, 20);
    setExpanded('true');
    panel.querySelector('button').focus();
  }

  const openPicker = () => (view === 'table' ? openTable() : openMenu());

  (headerLayout ? picker.closest('gem-button') : picker).addEventListener('click', () => {
    if (Q.nomenu === '1' || opening) return;
    if (mainPop) {
      closeAll();
      return;
    }
    if (Number(Q.delay)) {
      opening = true;
      setTimeout(() => { opening = false; openPicker(); }, Number(Q.delay));
    } else {
      openPicker();
    }
  });
  addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (flyPop) closeFlyout();
    else if (mainPop) closeAll();
  });
  input.addEventListener('keydown', (event) => {
    window.__lastKey = performance.now();
    if (event.key === 'Escape') window.__esc++;
  });

  // The page changes the URL without a reload, or changes the model by itself.
  const touch = () => document.body.appendChild(document.createElement('div')); // any DOM change
  window.__newChat = () => {
    history.pushState(null, '', '/app');
    if (Q.newChatResetsEffort === '1') effort = 'low';
    updatePill();
    touch();
  };
  // The page resets the thinking effort without any navigation: only the picker label gives it away.
  window.__resetEffort = () => {
    effort = 'low';
    updatePill();
    touch();
  };
  window.__conversation = () => {
    history.pushState(null, '', '/app/abc123');
    touch();
  };
  window.__setModel = (id) => {
    model = id;
    updatePill();
    touch();
  };

  updatePill();
  if (Q.nofocus !== '1') input.focus();
}

const mockPage = (url) => {
  const q = Object.fromEntries(new URL(url).searchParams);
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>mock</title>
<style>
  body { font: 14px sans-serif; }
  bard-mode-switcher, gem-popover, gem-menu, gem-menu-item, gem-icon, mat-icon, .leading-container { display: block; }
  gem-menu-item-content { display: flex; gap: 8px; }
  .leading-container { width: 24px; }
  mat-icon { width: 16px; height: 16px; }
  gem-menu { padding: 4px; min-width: 240px; }
  gem-menu-item { padding: 6px 8px; }
  .cdk-overlay-popover { position: fixed; inset: auto; margin: 0; padding: 0; border: 1px solid #888; background: #fff; }
</style>
<body>
<div id="input" class="ql-editor ql-blank" role="textbox" contenteditable="true" aria-label="Einen Prompt für Gemini eingeben" style="border:1px solid #ccc;min-height:24px"></div>
${
  q.layout === 'header'
    ? `<bard-mode-switcher class="sparkle-in-header mode-picker-in-header" data-test-id="bard-mode-switcher">
  <div class="pill-ui-logo-container with-attribution in-header" role="group">
    <gem-button class="gds-mode-switch-button logo-pill-btn" data-test-id="bard-mode-menu-button"><button id="picker" type="button" aria-label="Modusauswahl öffnen, derzeit ausgewählt: Automatic" aria-disabled="false"><span class="logo-pill-label-container"><bard-logo><span class="bard-text">Gemini</span></bard-logo> <span id="pl"></span><span id="pe"></span></span></button></gem-button>
    <gem-popover></gem-popover>
  </div>
</bard-mode-switcher>`
    : `<bard-mode-switcher>
  <div class="pill-ui-logo-container gem-menu-redesign under-input" role="group">
    <button id="picker" class="input-area-switch" type="button" aria-haspopup="true" aria-expanded="false" aria-disabled="false" data-test-id="bard-mode-menu-button"><span class="logo-pill-label-container"><span id="pl"></span><span id="pe"></span></span></button>
    <gem-popover></gem-popover>
  </div>
</bard-mode-switcher>`
}
<script>window.Q = ${JSON.stringify(q)};</script>
<script>(${mockMain})();</script></body>`;
};

const WAIT_MS = 8000; // enough for a full run: start delay, model, thinking effort, verification

const browser = await chromium.launch({ channel: 'msedge', headless: true });

/** Simulates a browser or userscript sandbox that refuses constructed stylesheets (seen with Firefox content scripts). */
const noConstructedStylesheets = () => {
  Object.defineProperty(Document.prototype, 'adoptedStyleSheets', {
    configurable: true,
    get: () => [],
    set: () => {
      throw new DOMException('simulated restriction', 'NotAllowedError');
    },
  });
};

/**
 * Simulates the Firefox userscript sandbox as seen in a real log: the event constructors refuse a `view` member
 * ("'view' member of UIEventInit does not implement interface Window"), so a script that passes `window` fails.
 */
const refuseEventView = () => {
  for (const name of ['PointerEvent', 'MouseEvent', 'KeyboardEvent']) {
    const Native = window[name];
    window[name] = class extends Native {
      constructor(type, init) {
        if (init && 'view' in init) throw new TypeError(`${name} constructor: 'view' member of UIEventInit does not implement interface Window.`);
        super(type, init);
      }
    };
  }
};

/** Keyboard events cannot be built at all: Escape is impossible, closing a menu has to go through the picker. */
const noKeyboardEvents = () => {
  window.KeyboardEvent = class {
    constructor() {
      throw new TypeError('KeyboardEvent cannot be constructed here');
    }
  };
};

/** Simulates the userscript manager API: GM_addStyle adds a <style> and records the CSS it was given. */
const gmAddStyleStub = () => {
  window.__gmStyles = [];
  window.GM_addStyle = (css) => {
    window.__gmStyles.push(css);
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  };
};

/**
 * world: 'isolated' loads the script like a userscript manager does with a @grant: into an isolated JavaScript world
 * of the page (own globals, shared DOM, like a content script), not into the page's own world. initIsolated runs in
 * that world before the script (e.g. the GM_addStyle stub); init runs in the page's world as usual.
 */
// A phone as the real page sees it: touch, a 360 px wide screen at three device pixels per CSS pixel, the user agent of
// Firefox on Android (the engine stays Chromium: this reproduces the layout and the touch input, not Firefox).
const PHONE = {
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0',
};

/** debugFlag: what 'gemini-best-model-debug' holds when the page starts ('1' console, 'panel' console and panel, null nothing). */
async function run({ name, query = '', path: urlPath = '/app', waitMs = WAIT_MS, locale = 'en-US', init, initIsolated, world, act, phone = false, debugFlag = '1' }) {
  const ctx = await browser.newContext({ locale, ...(phone ? PHONE : {}) });
  await ctx.route('https://gemini.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: mockPage(route.request().url()) }),
  );
  const page = await ctx.newPage();
  const lines = [];
  page.on('console', (m) => m.text().startsWith('[gemini-best-model]') && lines.push(m.text().replace('[gemini-best-model] ', '')));
  page.on('pageerror', (e) => lines.push('PAGEERROR ' + e.message));
  await page.addInitScript((flag) => {
    try {
      if (flag) localStorage.setItem('gemini-best-model-debug', flag);
    } catch (_) {}
  }, debugFlag);
  if (init) await page.addInitScript(init);
  if (world === 'isolated') {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Page.enable');
    const WORLD = 'userscript-sandbox';
    if (initIsolated) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${initIsolated})()`, worldName: WORLD });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src, worldName: WORLD });
  } else {
    await page.addInitScript({ content: src });
  }
  await page.goto(`https://gemini.google.com${urlPath}?${query}`);
  await page.waitForTimeout(waitMs);
  const extra = act ? await act(page) : {};
  const state = await page.evaluate(() => ({
    pill: document.getElementById('pl').textContent,
    model: window.__model(),
    effort: window.__effort(),
    selected: window.__selected,
    opens: window.__opens,
    flyouts: window.__flyoutOpens,
    disabledClicks: window.__disabledClicks,
    signIn: window.__signInClicks,
    esc: window.__esc,
    active: document.activeElement?.id || document.activeElement?.tagName,
    popovers: document.querySelectorAll('[popover]').length,
    opacity: window.__opacity,
    openTimes: window.__openTimes,
    lastKey: window.__lastKey,
    tableOpens: window.__tableOpens,
    panelClicks: window.__panelClicks,
    viewSwitches: window.__viewSwitches,
    panels: document.querySelectorAll('[data-gemini-best-model-panel]').length, // the script's own log panel
    flag: (() => {
      try {
        return localStorage.getItem('gemini-best-model-debug');
      } catch (_) {
        return 'blocked';
      }
    })(),
    panelText: [...document.querySelectorAll('[data-gemini-best-model-panel] > div')].at(-1)?.textContent || '',
  }));
  await withTimeout(ctx.close());
  return { name, ...state, ...extra, lines };
}

/** What the user sees in the menu: label and computed display of every entry of the given menu. */
const entriesOf = (selector) => (page) =>
  page.evaluate(
    (sel) => [...document.querySelectorAll(sel + ' gem-menu-item')].map((el) => ({ text: el.querySelector('.label').textContent.trim(), display: getComputedStyle(el).display })),
    selector,
  );

const user = {
  /** A real (trusted) click on the picker, then the list of the menu entries with their display value. */
  opensMenu: async (page) => {
    // what the script left behind, measured before the user opens the menu
    const before = await page.evaluate(() => ({ popovers: document.querySelectorAll('[popover]').length, active: document.activeElement?.id || document.activeElement?.tagName }));
    await page.click('#picker');
    await page.waitForTimeout(500);
    return { before, entries: await entriesOf('gem-menu[data-test-id="gem-mode-menu"]')(page), userOpacity: await page.evaluate(() => window.__opacity.at(-1)) };
  },
  /** The same with a finger: a real touch tap (needs a context with touch, see PHONE). */
  tapsMenu: async (page) => {
    const before = await page.evaluate(() => ({ popovers: document.querySelectorAll('[popover]').length, active: document.activeElement?.id || document.activeElement?.tagName }));
    await page.tap('#picker');
    await page.waitForTimeout(500);
    return { before, entries: await entriesOf('gem-menu[data-test-id="gem-mode-menu"]')(page), userOpacity: await page.evaluate(() => window.__opacity.at(-1)) };
  },
  /** Looks at the log panel: where it sits, then presses its first button ("Copy log") and reads the label afterwards. */
  usesPanel: async (page) => {
    const panel = page.locator('[data-gemini-best-model-panel]');
    const box = await panel.boundingBox();
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const buttons = await panel.locator('button').allTextContents();
    await panel.locator('button').first().tap().catch(() => panel.locator('button').first().click());
    await page.waitForTimeout(400);
    const afterCopy = await panel.locator('button').first().textContent();
    return { box, viewport, buttons, afterCopy };
  },
  /** Presses the n-th button of the log panel (0 copy, 1 turn off, 2 close). */
  pressesPanelButton: (n) => async (page) => {
    await page.locator('[data-gemini-best-model-panel] button').nth(n).click();
    await page.waitForTimeout(300);
  },
  /** Leaves the new-chat page for a conversation and comes back (the page notices a path change on its next look). */
  newChat: async (page) => {
    await page.evaluate(() => window.__conversation());
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__newChat());
  },
};

const DEFS = [
  // --- the rules: lowest unlocked model, highest unlocked effort ---
  { name: 'default' },
  { name: 'model already best', query: 'model=n' },
  { name: 'everything already best', query: 'model=n&effort=high' },
  { name: 'highest effort locked', query: 'lastLocked=1' },
  { name: 'highest effort disabled', query: 'lastDisabled=1' },
  { name: 'new model at the bottom', query: 'tier=extra' },
  { name: 'all models unlocked', query: 'tier=pro' },
  { name: 'signed out', query: 'tier=anon', waitMs: 9000 }, // 3 looks, 2.5 s apart
  { name: 'no thinking-effort entry', query: 'noeffort=1' },
  { name: 'page resets effort on model change', query: 'effort=high&resetEffort=1' },
  { name: 'conversation URL on load', path: '/app/abc123' },
  // --- how the submenu opens ---
  { name: 'submenu on hover only', query: 'sub=hover' },
  { name: 'submenu on click only', query: 'sub=click' },
  { name: 'submenu on arrow right only', query: 'sub=key', waitMs: 12000 },
  { name: 'submenu outside the switcher', query: 'flyout=body' },
  { name: 'effort options inside an expandable entry', query: 'sub=inline' },
  // --- the stylesheet is refused (Firefox userscript sandbox): the inline fallback does the hiding ---
  { name: 'no stylesheet: the script works and stays invisible', init: noConstructedStylesheets },
  { name: 'no stylesheet: locked model is hidden', query: 'model=n&effort=high', init: noConstructedStylesheets, act: user.opensMenu },
  // --- run by a userscript manager in its sandbox: GM_addStyle exists ---
  {
    name: 'userscript manager provides GM_addStyle',
    query: 'model=n&effort=high',
    init: gmAddStyleStub,
    act: async (page) => ({ ...(await user.opensMenu(page)), gm: await page.evaluate(() => window.__gmStyles) }),
  },
  // --- in an isolated JavaScript world, as a userscript manager runs a script with a @grant (Firefox: a content script) ---
  { name: 'isolated world: works, invisible, locked model hidden', world: 'isolated', act: user.opensMenu },
  { name: 'isolated world with GM_addStyle', world: 'isolated', initIsolated: gmAddStyleStub, act: user.opensMenu },
  { name: 'isolated world, stylesheets refused', world: 'isolated', initIsolated: noConstructedStylesheets, act: user.opensMenu },
  { name: 'isolated world, events refuse a "view" member (Firefox sandbox)', world: 'isolated', initIsolated: refuseEventView, act: user.opensMenu },
  { name: 'isolated world without keyboard events', world: 'isolated', initIsolated: noKeyboardEvents, act: user.opensMenu },
  // --- narrow window: the picker moved into the header and is marked differently (real page, 870x600) ---
  { name: 'header layout (narrow window)', query: 'layout=header', act: user.opensMenu },
  { name: 'header layout: new chat resets the effort', query: 'layout=header&model=n&effort=high&newChatResetsEffort=1', waitMs: 3500, act: async (page) => { await user.newChat(page); await page.waitForTimeout(7000); } },
  // --- a phone: touch, 360 px, header layout with the expandable effort entry (the real page at 360x780, mobile user agent) ---
  { name: 'phone: touch, header layout, expandable entry', phone: true, query: 'layout=header&sub=inline', act: user.tapsMenu },
  { name: 'phone: a tap on the picker counts as own choice', phone: true, query: 'layout=header&sub=inline&delay=2000&model=n&effort=high', waitMs: 1600, act: async (page) => { await page.tap('#picker'); await page.waitForTimeout(5000); } },
  // --- the on-screen log for devices without a console: ?gbm-debug in the address switches it on ---
  { name: 'panel: ?gbm-debug switches the log panel on', query: 'gbm-debug', debugFlag: null, act: user.usesPanel },
  { name: 'panel: ?gbm-debug= (a server may rewrite the address like this) switches it on as well', query: 'gbm-debug=', debugFlag: null, waitMs: 2500 },
  { name: 'panel on a phone', phone: true, query: 'gbm-debug&layout=header&sub=inline', debugFlag: null, act: user.usesPanel },
  { name: 'panel in the userscript sandbox', world: 'isolated', initIsolated: gmAddStyleStub, query: 'gbm-debug', debugFlag: null, act: user.usesPanel },
  { name: 'panel: ?gbm-debug=off switches it off', query: 'gbm-debug=off', debugFlag: 'panel' },
  { name: 'panel: "Turn off" removes it and the setting', query: 'gbm-debug', debugFlag: null, waitMs: 2500, act: user.pressesPanelButton(1) },
  { name: 'panel: "Close" removes it for this page only', query: 'gbm-debug', debugFlag: null, waitMs: 2500, act: user.pressesPanelButton(2) },
  // --- the picker shows the periodic table instead of the list menu ---
  { name: 'periodic table view: the script presses "List view"', query: 'view=table' },
  { name: 'periodic table view without a "List view" switch', query: 'view=table&nolist=1', waitMs: 9000 },
  // --- the page differs from what the script expects: the debug log carries an outline of the page ---
  { name: 'submenu never opens', query: 'sub=none', waitMs: 9000 },
  { name: 'every thinking effort is locked', query: 'model=n&levelsLocked=1' },
  // --- focus, language ---
  { name: 'focus: chat input had it' },
  { name: 'focus: nothing had it', query: 'nofocus=1' },
  { name: 'german messages', locale: 'de-DE' },
  // --- hiding locked entries ---
  { name: 'locked model is hidden', query: 'model=n&effort=high', act: user.opensMenu },
  { name: 'locked models are hidden when signed out', query: 'tier=anon', waitMs: 9000, act: user.opensMenu },
  {
    name: 'locked effort is hidden in a submenu outside the switcher',
    query: 'model=n&effort=mid&lastLocked=1&flyout=body',
    act: async (page) => {
      await page.click('#picker');
      await page.hover('gem-menu-item[aria-haspopup="true"]');
      await page.waitForTimeout(700);
      return {
        levels: await entriesOf('gem-menu[data-test-id="thinking-level-menu"]')(page),
        marked: await page.evaluate(() => document.querySelector('gem-menu[data-test-id="thinking-level-menu"]')?.hasAttribute('data-gemini-best-model-menu')),
      };
    },
  },
  // --- the page changes things: new chat, first message, model changed by the page, own choice ---
  {
    name: 'new chat resets the effort',
    query: 'model=n&effort=high&newChatResetsEffort=1',
    waitMs: 3500,
    act: async (page) => {
      await user.newChat(page);
      await page.waitForTimeout(7000);
    },
  },
  {
    name: 'first message does not open the menu',
    query: 'model=n&effort=high',
    waitMs: 3500,
    act: async (page) => {
      await page.evaluate(() => window.__conversation());
      await page.waitForTimeout(3500);
    },
  },
  {
    name: 'the page changes the model by itself',
    query: 'model=n&effort=high',
    waitMs: 3500,
    act: async (page) => {
      await page.evaluate(() => window.__setModel('h'));
      await page.waitForTimeout(7000);
    },
  },
  {
    name: 'the page resets the effort by itself',
    query: 'model=n&effort=high',
    waitMs: 3500,
    act: async (page) => {
      await page.evaluate(() => window.__resetEffort()); // no navigation: the picker label ("Neon Hoch" -> "Neon") gives it away
      await page.waitForTimeout(7000);
    },
  },
  {
    name: 'user choice survives a new chat',
    query: 'model=n&effort=high&newChatResetsEffort=1',
    waitMs: 3500,
    act: async (page) => {
      await page.click('#picker'); // real (trusted) clicks
      await page.click('gem-menu-item:has-text("Hilfe im Alltag")');
      await page.waitForTimeout(500);
      await user.newChat(page);
      await page.waitForTimeout(5000);
    },
  },
  {
    name: 'user clicks the picker while the script is busy',
    query: 'delay=2000&model=n&effort=high',
    waitMs: 1600,
    act: async (page) => {
      await page.click('#picker'); // trusted click inside the busy window
      await page.waitForTimeout(5000);
    },
  },
  {
    name: 'typing delays the script',
    alone: true, // paced in real time: under the load of the parallel scenarios the gaps between keys would exceed the quiet time
    waitMs: 100,
    act: async (page) => {
      await page.focus('#input');
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('a');
        await page.waitForTimeout(400);
      }
      const opensWhileTyping = await page.evaluate(() => window.__opens);
      await page.waitForTimeout(8000);
      return { opensWhileTyping };
    },
  },
  // --- safety nets ---
  { name: 'page keeps resetting the model', query: 'reset=1', waitMs: 30000 },
  {
    name: 'menu never opens',
    query: 'nomenu=1',
    waitMs: 31000, // five attempts
    act: async (page) => {
      await user.newChat(page);
      await page.waitForTimeout(8000);
    },
  },
];

const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
const chosen = DEFS.filter((def) => !only || only.test(def.name));

/** A crashing scenario must not take the others down: its error becomes a failed check. */
const safeRun = async (def) => {
  try {
    return await run(def);
  } catch (error) {
    return { name: def.name, error: String(error.message || error).split('\n')[0] };
  }
};

/** Runs the scenarios with at most `limit` pages at a time: too many pages at once starve each other of CPU. */
async function pool(defs, limit) {
  const done = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < defs.length) done.push(await safeRun(defs[next++]));
    }),
  );
  return done;
}

const cases = await pool(chosen.filter((def) => !def.alone), 10);
for (const def of chosen.filter((def) => def.alone)) cases.push(await safeRun(def)); // one at a time, nothing else running
await withTimeout(browser.close());

const by = Object.fromEntries(cases.map((c) => [c.name, c]));
/** Runs the checks of one scenario, if it was part of this run. */
const on = (name, fn) => {
  const c = by[name];
  if (!c) return;
  if (c.error) check(`${name}: the scenario ran`, false, c.error);
  else fn(c);
};
const show = (c) =>
  `pill=${c.pill} selected=${JSON.stringify(c.selected)} opens=${c.opens} flyouts=${c.flyouts} disabled=${c.disabledClicks} signIn=${c.signIn} esc=${c.esc} active=${c.active} popovers=${c.popovers} log=[${c.lines.join(' | ')}]`;
const BEST = ['model:Detaillierte Analyse', 'effort:Hoch'];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const noBadClicks = (c) => c.disabledClicks === 0 && c.signIn === 0;
const noErrors = (c) => !c.lines.some((l) => l.startsWith('PAGEERROR') || /failed/.test(l));

on('default', (c) => {
  check('default: best unlocked model, then highest effort', eq(c.selected, BEST) && c.pill === 'Neon' && c.effort === 'high', show(c));
  check('default: locked and disabled entries are never clicked, no Escape reaches the chat input', noBadClicks(c) && c.esc === 0, show(c));
  check('default: three looks (model, effort, verification), everything closed afterwards', c.opens === 3 && c.popovers === 0 && noErrors(c), show(c));
  check('default: the always-printed line says the script is loaded, in page context', c.lines.some((l) => /loaded \(page context\)/.test(l)), show(c));
  check('default: every popover is invisible while the script works', c.opacity.length >= 4 && c.opacity.every((o) => o === '0'), JSON.stringify(c.opacity));
  check('default: the console log (setting "1") shows no panel on the page', c.panels === 0 && c.flag === '1' && c.lines.some((l) => /^environment: /.test(l)) && c.lines.some((l) => /^model picker found: /.test(l)), show(c));
});
on('model already best', (c) => {
  check('model already best: only the effort is changed', eq(c.selected, ['effort:Hoch']) && c.opens === 2, show(c));
});
on('everything already best', (c) => {
  check('everything already best: nothing is clicked, one look', c.selected.length === 0 && c.opens === 1 && c.popovers === 0, show(c));
  check('everything already best: the log names model and effort', c.lines.some((l) => /already the best: Detaillierte Analyse \(4 Neon\), thinking effort Hoch/.test(l)), show(c));
});
on('highest effort locked', (c) => {
  check('highest effort locked: the highest unlocked one wins', eq(c.selected, ['model:Detaillierte Analyse', 'effort:Mittel']) && noBadClicks(c), show(c));
});
on('highest effort disabled', (c) => {
  check('highest effort disabled: the highest enabled one wins', eq(c.selected, ['model:Detaillierte Analyse', 'effort:Mittel']) && noBadClicks(c), show(c));
});
on('new model at the bottom', (c) => {
  check('a new model at the bottom of the menu is chosen without changes to the script', eq(c.selected, ['model:Zukünftiges Modell', 'effort:Hoch']) && c.pill === 'Argon', show(c));
});
on('all models unlocked', (c) => {
  check('all models unlocked: the last one is chosen', eq(c.selected, ['model:Code und komplexe Aufgaben', 'effort:Hoch']) && c.pill === 'Carbon', show(c));
});
on('signed out', (c) => {
  check('signed out: nothing is clicked, not even the sign-in entry', c.selected.length === 0 && noBadClicks(c) && c.pill === 'Automatic', show(c));
  check('signed out: a menu with a single model is looked at three times, then left alone', c.opens === 3 && c.popovers === 0 && c.lines.filter((l) => /single model only/.test(l)).length === 2, show(c));
});
on('no thinking-effort entry', (c) => {
  check('no thinking-effort entry: the model is chosen, no error', eq(c.selected, ['model:Detaillierte Analyse']) && c.opens === 2 && c.flyouts === 0 && noErrors(c), show(c));
  check('no thinking-effort entry: the log says so', c.lines.some((l) => /no thinking-effort entry/.test(l)), show(c));
});
on('page resets effort on model change', (c) => {
  check('page resets the effort when the model changes: effort is set afterwards', eq(c.selected, BEST) && c.effort === 'high', show(c));
});
on('conversation URL on load', (c) => {
  check('conversation URL on load: chosen as well', eq(c.selected, BEST), show(c));
});
for (const name of ['submenu on hover only', 'submenu on click only', 'submenu on arrow right only', 'submenu outside the switcher']) {
  on(name, (c) => {
    check(`${name}: model and effort are chosen`, eq(c.selected, BEST) && c.popovers === 0 && noBadClicks(c) && noErrors(c), show(c));
  });
}
on('effort options inside an expandable entry', (c) => {
  check('expandable entry: the options inside it are not taken for models; model first, then the highest effort', eq(c.selected, BEST) && c.pill === 'Neon' && c.effort === 'high' && c.popovers === 0 && noBadClicks(c) && noErrors(c), show(c));
});
on('submenu outside the switcher', (c) => {
  check('submenu outside the switcher: invisible while the script works', c.opacity.length >= 4 && c.opacity.every((o) => o === '0'), JSON.stringify(c.opacity));
});
on('userscript manager provides GM_addStyle', (c) => {
  const hidden = c.entries.filter((e) => e.display === 'none').map((e) => e.text);
  check('GM_addStyle: the script hands its CSS to the manager once', c.gm.length === 1 && /:has\(/.test(c.gm[0]) && /data-gemini-best-model-busy/.test(c.gm[0]), JSON.stringify(c.gm).slice(0, 300));
  check('GM_addStyle: the locked model is hidden', eq(hidden, ['Code und komplexe Aufgaben']), JSON.stringify(c.entries));
  check('GM_addStyle: the always-printed line names the sandbox mode', c.lines.some((l) => /loaded \(userscript sandbox\)/.test(l)), show(c));
});
for (const name of [
  'isolated world: works, invisible, locked model hidden',
  'isolated world with GM_addStyle',
  'isolated world, stylesheets refused',
  'isolated world, events refuse a "view" member (Firefox sandbox)',
  'isolated world without keyboard events',
]) {
  on(name, (c) => {
    const hidden = c.entries.filter((e) => e.display === 'none').map((e) => e.text);
    const own = c.opacity.slice(0, -1); // the last popover is the one the user opened
    check(`${name}: model and effort are chosen`, eq(c.selected, BEST) && noBadClicks(c) && noErrors(c), show(c));
    check(`${name}: every popover of the script is invisible`, own.length >= 4 && own.every((o) => o === '0'), JSON.stringify(c.opacity));
    check(`${name}: the locked model is hidden, the menu the user opens is visible`, eq(hidden, ['Code und komplexe Aufgaben']) && c.userOpacity === '1', JSON.stringify(c.entries));
  });
}
on('isolated world with GM_addStyle', (c) => {
  check('isolated world with GM_addStyle: the always-printed line names the sandbox mode', c.lines.some((l) => /loaded \(userscript sandbox\)/.test(l)), show(c));
});
on('no stylesheet: the script works and stays invisible', (c) => {
  check('no stylesheet: model and effort are chosen', eq(c.selected, BEST) && noBadClicks(c) && noErrors(c), show(c));
  check('no stylesheet: every popover is still invisible while the script works (inline styles)', c.opacity.length >= 4 && c.opacity.every((o) => o === '0'), JSON.stringify(c.opacity));
});
on('no stylesheet: locked model is hidden', (c) => {
  const hidden = c.entries.filter((e) => e.display === 'none').map((e) => e.text);
  check('no stylesheet: the locked model is hidden by the inline fallback', eq(hidden, ['Code und komplexe Aufgaben']) && c.userOpacity === '1', JSON.stringify(c.entries));
});
on('header layout (narrow window)', (c) => {
  const hidden = c.entries.filter((e) => e.display === 'none').map((e) => e.text);
  const own = c.opacity.slice(0, -1); // the last popover is the one the user opened
  check('header layout: the picker is found, model and effort are chosen', eq(c.selected, BEST) && noBadClicks(c) && noErrors(c), show(c));
  check('header layout: the menus are closed again although the picker button has no aria-expanded, focus is back in the input, and the popovers were invisible while the script worked', c.before.popovers === 0 && c.before.active === 'input' && own.length >= 4 && own.every((o) => o === '0'), JSON.stringify(c.before) + ' ' + JSON.stringify(c.opacity));
  check('header layout: the locked model is hidden, the menu the user opens is visible', eq(hidden, ['Code und komplexe Aufgaben']) && c.userOpacity === '1', JSON.stringify(c.entries));
});
on('header layout: new chat resets the effort', (c) => {
  check('header layout: a new chat is looked at and the reset effort is set again', eq(c.selected, ['effort:Hoch']) && c.opens === 3 && c.effort === 'high', show(c));
});
on('phone: touch, header layout, expandable entry', (c) => {
  const hidden = c.entries.filter((e) => e.display === 'none').map((e) => e.text);
  const own = c.opacity.slice(0, -1); // the last popover is the one the user opened
  check('phone: the picker is found, model and effort are chosen through the expandable entry', eq(c.selected, BEST) && c.effort === 'high' && noBadClicks(c) && noErrors(c), show(c));
  // three looks, one popover each (the options sit inside the entry, there is no flyout), then the one the user opened
  check('phone: everything is closed again, focus is back in the input, the popovers were invisible while the script worked', c.before.popovers === 0 && c.before.active === 'input' && own.length >= 3 && own.every((o) => o === '0'), JSON.stringify(c.before) + ' ' + JSON.stringify(c.opacity));
  check('phone: after a tap on the picker the locked model is hidden and the menu is visible', eq(hidden, ['Code und komplexe Aufgaben']) && c.userOpacity === '1', JSON.stringify(c.entries));
  check('phone: the log names the device (touch points, user agent of Firefox on Android)', c.lines.some((l) => /^environment: .*Android.*touch points [1-9]/.test(l)), show(c));
});
on('phone: a tap on the picker counts as own choice', (c) => {
  check('phone: a real tap on the picker during the busy window counts as own choice', c.lines.some((l) => /user selection detected/.test(l)), show(c));
});
on('panel: ?gbm-debug switches the log panel on', (c) => {
  check('panel: ?gbm-debug in the address stores the setting and shows exactly one panel', c.flag === 'panel' && c.panels === 1, `flag=${c.flag} panels=${c.panels}`);
  check('panel: the panel holds the loaded line, the environment, the picker and what the script did', /loaded \(page context\), debug log and panel on/.test(c.panelText) && /environment: /.test(c.panelText) && /model picker found: /.test(c.panelText) && /model selected: Detaillierte Analyse/.test(c.panelText) && /thinking effort selected: Hoch/.test(c.panelText), c.panelText.slice(0, 600));
  check('panel: it does not change what the script does (three looks, best model and effort, nothing left open)', eq(c.selected, BEST) && c.opens === 3 && c.popovers === 0 && noBadClicks(c) && noErrors(c), show(c));
  check('panel: it sits at the bottom edge, full width, and shows three buttons (copy, turn off, close)', c.box && Math.abs(c.box.y + c.box.height - c.viewport.height) < 2 && Math.abs(c.box.width - c.viewport.width) < 2 && eq(c.buttons, ['Copy log', 'Turn off', 'Close']), JSON.stringify({ box: c.box, viewport: c.viewport, buttons: c.buttons }));
  check('panel: the copy button answers (copied, or it says the copy failed)', c.afterCopy === 'Copied' || /^Copy failed/.test(c.afterCopy), String(c.afterCopy));
  check('panel: the lines are in the console as well', c.lines.some((l) => /model selected: /.test(l)), show(c));
});
on('panel: ?gbm-debug= (a server may rewrite the address like this) switches it on as well', (c) => {
  check('panel: ?gbm-debug= (empty value) switches the panel on too', c.flag === 'panel' && c.panels === 1, `flag=${c.flag} panels=${c.panels}`);
});
on('panel on a phone', (c) => {
  check('panel on a phone: it fits the screen width and the script still does its work', c.box && c.box.width <= c.viewport.width + 1 && c.box.height <= 0.41 * c.viewport.height && c.viewport.width === 360 && eq(c.selected, BEST) && noErrors(c), JSON.stringify({ box: c.box, viewport: c.viewport }) + ' ' + show(c));
});
on('panel in the userscript sandbox', (c) => {
  check('panel in the sandbox (isolated world, GM_addStyle): stored setting, one panel, the loaded line names the sandbox, nothing changes for the script', c.flag === 'panel' && c.panels === 1 && /loaded \(userscript sandbox\), debug log and panel on/.test(c.panelText) && eq(c.selected, BEST) && noErrors(c), `flag=${c.flag} panels=${c.panels} ${c.panelText.slice(0, 200)} ${show(c)}`);
  check('panel in the sandbox: its buttons work there too', c.afterCopy === 'Copied' || /^Copy failed/.test(c.afterCopy), String(c.afterCopy));
});
on('panel: ?gbm-debug=off switches it off', (c) => {
  check('panel: ?gbm-debug=off clears the setting and shows no panel', c.flag === null && c.panels === 0, `flag=${c.flag} panels=${c.panels}`);
  check('panel off: the console gets the loaded line only, the script still works', c.lines.length === 1 && /debug log off: open the page with \?gbm-debug/.test(c.lines[0]) && eq(c.selected, BEST), show(c));
});
on('panel: "Turn off" removes it and the setting', (c) => {
  check('panel: "Turn off" removes the panel and the stored setting', c.panels === 0 && c.flag === null, `flag=${c.flag} panels=${c.panels}`);
});
on('panel: "Close" removes it for this page only', (c) => {
  check('panel: "Close" removes the panel but keeps the setting', c.panels === 0 && c.flag === 'panel', `flag=${c.flag} panels=${c.panels}`);
});
on('periodic table view: the script presses "List view"', (c) => {
  check('periodic table: the script switches to the list and chooses model and effort', eq(c.selected, BEST) && c.viewSwitches === 1 && c.tableOpens === 1 && noErrors(c), show(c));
  check('periodic table: nothing else in the panel is clicked (no tile, no "Unlock", not "Full table")', c.panelClicks === 0 && noBadClicks(c), `panelClicks=${c.panelClicks}; ${show(c)}`);
  check('periodic table: the panel is invisible while the script works, and the log says what it did', c.opacity.length >= 4 && c.opacity.every((o) => o === '0') && c.lines.some((l) => /switching to "List view"/.test(l)), JSON.stringify(c.opacity));
});
on('periodic table view without a "List view" switch', (c) => {
  // A failed attempt closes the panel again: otherwise the click that opens the second attempt would toggle it shut.
  check('no "List view" switch: nothing in the panel is clicked, nothing is chosen, each failed attempt closes the panel', c.panelClicks === 0 && c.viewSwitches === 0 && c.selected.length === 0 && noBadClicks(c) && c.tableOpens >= 2, show(c));
  check('no "List view" switch: the failure is logged with an outline of the panel', c.lines.some((l) => /model menu did not open/.test(l)) && c.lines.some((l) => /DOM outline/.test(l) && /The Periodic Table of Gemini/.test(l) && /Full table/.test(l) && /class="element-tile/.test(l)), show(c));
});
on('submenu never opens', (c) => {
  check('submenu never opens: the failure is logged with the entry name', c.lines.some((l) => /submenu "Denkaufwand" did not open/.test(l)), show(c));
  check('submenu never opens: the debug log carries an outline of the picker and its menu', c.lines.some((l) => /DOM outline/.test(l) && /bard-mode-switcher/.test(l) && /aria-haspopup="true"/.test(l)), show(c));
  check('submenu never opens: the chosen model stays and no entry was clicked wrongly', eq(c.selected, ['model:Detaillierte Analyse']) && noBadClicks(c), show(c));
});
on('every thinking effort is locked', (c) => {
  check('every effort locked: nothing is clicked in the submenu, the log says why', eq(c.selected, []) && noBadClicks(c) && c.lines.some((l) => /no selectable entry/.test(l)), show(c));
  check('every effort locked: the debug log carries an outline of the submenu', c.lines.some((l) => /DOM outline/.test(l) && /fonticon="lock"/.test(l)), show(c));
});
on('focus: chat input had it', (c) => {
  check('focus returns to the chat input', c.active === 'input' && eq(c.selected, BEST), show(c));
});
on('focus: nothing had it', (c) => {
  check('focus is not left on the picker if nothing had it before', c.active === 'BODY' && eq(c.selected, BEST), show(c));
});
on('german messages', (c) => {
  check('german browser language: german messages', c.lines.some((l) => /Modell gewählt/.test(l)) && c.lines.some((l) => /Denkaufwand gewählt/.test(l)) && c.lines.some((l) => /geladen \(/.test(l)), show(c));
});
on('locked model is hidden', (c) => {
  const hidden = c.entries.filter((e) => e.display === 'none').map((e) => e.text);
  const visible = c.entries.filter((e) => e.display !== 'none').map((e) => e.text);
  check('locked model is hidden in the menu the user opens', eq(hidden, ['Code und komplexe Aufgaben']) && eq(visible, ['Automatic', 'Hilfe im Alltag', 'Detaillierte Analyse', 'Denkaufwand']), JSON.stringify(c.entries));
  check('the menu the user opens is visible (only the script hides it)', c.userOpacity === '1', String(c.userOpacity));
});
on('locked models are hidden when signed out', (c) => {
  const hidden = c.entries.filter((e) => e.display === 'none').map((e) => e.text);
  const visible = c.entries.filter((e) => e.display !== 'none').map((e) => e.text);
  check('signed out: the three locked models are hidden, Automatic and the sign-in entry stay', eq(hidden, ['Hilfe im Alltag', 'Detaillierte Analyse', 'Code und komplexe Aufgaben']) && eq(visible, ['Automatic', 'Anmelden']), JSON.stringify(c.entries));
});
on('locked effort is hidden in a submenu outside the switcher', (c) => {
  const hidden = c.levels.filter((e) => e.display === 'none').map((e) => e.text);
  check('locked effort is hidden in a submenu that lives outside the switcher', eq(hidden, ['Hoch']) && c.levels.length === 3 && c.marked === true, JSON.stringify(c.levels));
  check('locked effort: the script left it alone (it was already the highest unlocked)', c.selected.length === 0 && noBadClicks(c), show(c));
});
on('new chat resets the effort', (c) => {
  check('new chat: the reset effort is set again', eq(c.selected, ['effort:Hoch']) && c.opens === 3 && c.effort === 'high', show(c));
});
on('first message does not open the menu', (c) => {
  check('first message of a chat (/app -> /app/<id>) does not open the menu', c.opens === 1 && c.selected.length === 0, show(c));
});
on('the page changes the model by itself', (c) => {
  check('the page changes the model by itself: the best model is chosen again', eq(c.selected, ['model:Detaillierte Analyse']) && c.pill === 'Neon' && c.opens === 3, show(c));
});
on('the page resets the effort by itself', (c) => {
  check('the page resets the effort without a navigation: the changed picker label triggers a look and the effort is set again', eq(c.selected, ['effort:Hoch']) && c.opens === 3 && c.effort === 'high', show(c));
});
on('user choice survives a new chat', (c) => {
  check('own choice survives a new chat until the page is reloaded', eq(c.selected, ['model:Hilfe im Alltag']) && c.pill === 'Hydrogen', show(c));
  check('own choice: the log says so', c.lines.some((l) => /user selection detected/.test(l)), show(c));
});
on('user clicks the picker while the script is busy', (c) => {
  check('real user click during the busy window counts as own choice', c.lines.some((l) => /user selection detected/.test(l)), show(c));
});
on('typing delays the script', (c) => {
  const wait = c.openTimes[0] - c.lastKey;
  check('typing: the menu is not opened while the user types', c.opensWhileTyping === 0, `opens while typing=${c.opensWhileTyping}`);
  check('typing: the script waits for a typing pause, then does its work', wait >= 1400 && eq(c.selected, BEST), `${Math.round(wait)} ms after the last key; ${show(c)}`);
});
on('page keeps resetting the model', (c) => {
  const models = c.selected.filter((s) => s.startsWith('model:')).length;
  check('loop guard: pauses when the page keeps resetting the selection', c.lines.some((l) => /pausing for 120 s/.test(l)), show(c));
  check('loop guard: the number of clicks stays bounded', models <= 12, `${models} model clicks; ${show(c)}`);
});
on('menu never opens', (c) => {
  const attempts = c.lines.filter((l) => /^attempt \d failed/.test(l));
  check('failed attempts are retried, up to 5', attempts.slice(0, 5).map((l) => l[8]).join('') === '12345', show(c));
  check('after 5 failures no sixth attempt before the page changes', !c.lines.some((l) => l.startsWith('attempt 6')), show(c));
  check('a new chat resets the failure counter: attempts start again', attempts.filter((l) => l.startsWith('attempt 1 failed')).length === 2, show(c));
  check('no Escape is sent to the chat input when no menu is open', c.esc === 0, show(c));
});

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
process.exit(failedChecks.length ? 1 : 0);
