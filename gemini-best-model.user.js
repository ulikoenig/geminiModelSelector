// ==UserScript==
// @name         Gemini: auto-select best model and thinking effort
// @name:de      Gemini: bestes Modell und höchsten Denkaufwand automatisch wählen
// @namespace    gemini-model-selector
// @version      1.0.4
// @description  Gemini web app: selects the best model available to you (the lowest unlocked entry of the model picker) and the highest available thinking effort. Entries with a lock icon are hidden from the picker menu.
// @description:de  Gemini-Web-App: wählt das beste verfügbare Modell (den untersten freigeschalteten Eintrag der Modellauswahl) und den höchsten verfügbaren Denkaufwand. Einträge mit Schloss-Symbol werden im Auswahlmenü ausgeblendet.
// @match        https://gemini.google.com/app*
// @match        https://gemini.google.com/u/*/app*
// @run-at       document-start
// @noframes
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

/*
 * Rules
 *   model            The picker menu lists its models from small to large (Automatic first). Of all
 *                    selectable entries (role="menuitemradio", not locked, not disabled) the LAST one is chosen.
 *   thinking effort  The model menu ends with an entry that opens a submenu (aria-haspopup, label "Denkaufwand"
 *                    in German UI). It is recognised by its structure, not by its label, so it works in every UI
 *                    language. In the submenu the LAST selectable entry is chosen.
 *   locked entries   Menu entries that show a lock icon are hidden (the menu, and a submenu that belongs to it) and
 *                    are never clicked. They are hidden twice over: by a constructed stylesheet and, in case the
 *                    browser or the userscript sandbox refuses that, by inline styles the script sets itself.
 *                    Entries that are merely disabled stay visible but are never clicked.
 *
 * Two layouts of the picker: under the input (wide window) and in the header (narrow window, shown as "Gemini Neon").
 * Both open the same list menu; only the picker button is marked differently (see pickerButton).
 *
 * Two views of the picker: besides the list menu there is "The Periodic Table of Gemini" (a panel with a "Full table"
 * and a "List view" switch). If the picker opens that panel, the script presses "List view" and goes on with the list.
 * If the panel has no such switch, the script clicks nothing in it and, with the debug log on, writes an outline of it.
 *
 * The script looks at the menu with the page's own controls: it opens the model menu, reads the check marks and
 * clicks the first entry that is not yet as wanted. The page closes the menu on a click, so the script looks again
 * (at most 4 passes: model, thinking effort, verification). The model comes first because changing it may reset the
 * thinking effort. If everything is already as wanted nothing is clicked.
 *
 * When it runs: once after the page has loaded, whenever the picker label changes (the page or someone else changed
 * the model or the thinking effort: the label shows both, e.g. "Neon Hoch", the effort only while it is not the lowest)
 * and whenever a new chat is opened (the path becomes /app again; a new chat is looked at once to be sure, because
 * the lowest effort is not part of the label). Sending the first message of a chat (/app becomes /app/<id>) does not
 * open the menu.
 *
 * The user's own choice wins: if the user operates the model menu themselves (real click or key press), the script
 * does not touch it again until the page is reloaded.
 *
 * Safety nets: 5 attempts that clicked something within 30 s (the page keeps resetting the selection) pause the script
 * for 2 minutes; after 5 failed attempts in a row it stops until the picker label or the chat changes. It never opens the menu while the
 * user is typing, keyboard focus returns to where it was, and Escape is only sent while a menu is open. The menu is
 * invisible while the script works (no flicker). Only the main window is handled, not iframes.
 *
 * Why @grant GM_addStyle and not @grant none: with "none" a userscript manager has to inject the script into the
 * page as an inline <script>, which the strict Content-Security-Policy of Gemini blocks in Firefox (and which privacy
 * extensions make worse). With a grant the manager runs the script in its own sandbox, which no page policy can
 * block. The script only needs the DOM, events and localStorage, all of which the sandbox shares with the page.
 * GM_addStyle is used for the styles if it exists; the script works without it, too (see installStyles).
 *
 * Localization: console messages exist in English and German (see MESSAGES). The language follows the browser
 * language; every language other than German falls back to English. The userscript header carries localized
 * @name:de / @description:de for Tampermonkey.
 *
 * Console output: one line when the script is loaded (so it is clear that it runs at all). Everything else is
 * debug output: localStorage.setItem('gemini-best-model-debug', '1'), then reload the page.
 */
(function () {
  'use strict';

  if (window.top !== window.self) return; // main window only, not in iframes of the page

  // ---------- Localization ----------

  const MESSAGES = {
    en: {
      active: 'active',
      loaded: (version, mode, debug) =>
        `${version} loaded (${mode})${debug ? ', debug log on' : ", debug log off: localStorage.setItem('gemini-best-model-debug', '1') and reload"}`,
      userSelection: 'user selection detected, automation paused until the page is reloaded',
      menuState: (list) => `menu: ${list}`,
      domOutline: (text) => `DOM outline (for a bug report):\n${text}`,
      switchingView: (text) => `the picker shows a panel instead of the list menu, switching to "${text}"`,
      selectedModel: (text) => `model selected: ${text}`,
      selectedEffort: (text) => `thinking effort selected: ${text}`,
      alreadyBest: (model, effort) => `already the best: ${model}${effort ? `, thinking effort ${effort}` : ''}`,
      noEffortMenu: 'no thinking-effort entry for this model',
      thinMenu: 'the menu offers a single model only (the page may still be loading), looking again later',
      attemptFailed: (n, reason) => `attempt ${n} failed: ${reason}`,
      errNoPicker: 'model picker not found',
      errMenuNotOpened: 'model menu did not open',
      errNoModel: 'menu has no selectable model',
      errSubmenuNotOpened: (text) => `submenu "${text}" did not open`,
      errNoLevel: 'thinking-effort menu has no selectable entry',
      errUnstable: 'selection did not settle (the page keeps changing it)',
      switchLoop: (seconds) => `the page keeps resetting the selection: pausing for ${seconds} s`,
    },
    de: {
      active: 'aktiv',
      loaded: (version, mode, debug) =>
        `${version} geladen (${mode})${debug ? ', Debug-Log an' : ", Debug-Log aus: localStorage.setItem('gemini-best-model-debug', '1') und neu laden"}`,
      userSelection: 'Nutzerauswahl erkannt, Automatik pausiert bis zum Neuladen der Seite',
      menuState: (list) => `Menü: ${list}`,
      domOutline: (text) => `DOM-Auszug (für eine Fehlermeldung):\n${text}`,
      switchingView: (text) => `Die Auswahl zeigt ein Panel statt der Menüliste, wechsle zu "${text}"`,
      selectedModel: (text) => `Modell gewählt: ${text}`,
      selectedEffort: (text) => `Denkaufwand gewählt: ${text}`,
      alreadyBest: (model, effort) => `bereits das beste: ${model}${effort ? `, Denkaufwand ${effort}` : ''}`,
      noEffortMenu: 'kein Denkaufwand-Eintrag für dieses Modell',
      thinMenu: 'Das Menü bietet nur ein Modell (die Seite lädt womöglich noch), schaue später erneut nach',
      attemptFailed: (n, reason) => `Fehlversuch ${n}: ${reason}`,
      errNoPicker: 'Modellauswahl nicht gefunden',
      errMenuNotOpened: 'Modellmenü öffnete sich nicht',
      errNoModel: 'Menü ohne wählbares Modell',
      errSubmenuNotOpened: (text) => `Untermenü "${text}" öffnete sich nicht`,
      errNoLevel: 'Denkaufwand-Menü ohne wählbaren Eintrag',
      errUnstable: 'Auswahl wurde nicht stabil (die Seite ändert sie immer wieder)',
      switchLoop: (seconds) => `Die Seite setzt die Auswahl immer wieder zurück: pausiere für ${seconds} s`,
    },
  };

  const lang = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en')
    .toLowerCase()
    .startsWith('de')
    ? 'de'
    : 'en';
  const t = MESSAGES[lang];

  // ---------- Configuration ----------

  const CFG = {
    startDelayMs: 1000, // wait this long after the picker first shows up (the page may still be hydrating)
    cooldownMs: 2500, // minimum gap between two attempts
    maxAttempts: 5, // consecutive failures, then stay quiet until the picker label or the chat changes
    stepTimeoutMs: 3000, // wait time per menu step
    settleMs: 150, // let a closing menu finish before it is shown or measured again
    maxPasses: 4, // look at the menu this often per attempt: model, thinking effort, verification, one reset
    typingQuietMs: 1500, // never open the menu this soon after a key press of the user
    thinRuns: 3, // a menu with a single model may be an unfinished page: look again this many times
    hideMenu: true, // keep the menu invisible while the script works (no flicker)
    loopMax: 5, // this many changes within loopWindowMs mean the page resets the selection ...
    loopWindowMs: 30000,
    loopPauseMs: 120000, // ... so the script pauses for this long
  };

  let DEBUG = false;
  try {
    DEBUG = localStorage.getItem('gemini-best-model-debug') === '1';
  } catch (_) {
    /* storage blocked: continue without debug output */
  }
  const log = (...args) => DEBUG && console.log('[gemini-best-model]', ...args);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const BUSY_ATTR = 'data-gemini-best-model-busy';
  const MENU_ATTR = 'data-gemini-best-model-menu'; // marks a menu of the picker that lives outside <bard-mode-switcher>

  // ---------- DOM access ----------

  // <bard-mode-switcher> holds the picker button; its menu (a <gem-menu role="menu">) is rendered inside it.
  const PICKER_MARK = '[data-test-id="bard-mode-menu-button"]';
  const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
  const LOCK_ICON = /^lock(_outline(d)?)?$/;

  /**
   * The picker's <button>. Under the input (wide window) the mark sits on the <button> itself and the button carries
   * aria-haspopup/aria-expanded. In the header (narrow window, class "mode-picker-in-header") the mark sits on the
   * <gem-button> that wraps the <button>, and the button has neither aria-haspopup nor aria-expanded.
   */
  function pickerButton(switcher) {
    const marked = switcher.querySelector(PICKER_MARK);
    if (marked) return marked.tagName === 'BUTTON' ? marked : marked.querySelector('button') || marked;
    return switcher.querySelector('button[aria-haspopup]') || switcher.querySelector('[role="group"] button');
  }

  function findPicker() {
    const switchers = [...document.querySelectorAll('bard-mode-switcher')];
    // The page may keep a second switcher that is hidden at the current window width: take the visible one.
    const switcher = switchers.find((el) => el.getClientRects().length > 0) || switchers[0];
    return switcher ? pickerButton(switcher) : null;
  }

  const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const pickerLabel = (picker) => clean(picker.textContent);
  const pickerReady = (picker) =>
    picker.isConnected &&
    picker.getAttribute('aria-disabled') !== 'true' &&
    picker.closest(PICKER_MARK)?.getAttribute('aria-disabled') !== 'true' &&
    !picker.disabled &&
    pickerLabel(picker) !== '';
  // Only some layouts mark the open state on the picker; menusOpen() also looks at the menus themselves.
  const isPickerOpen = (picker) => [picker, picker.closest(PICKER_MARK)].some((el) => el?.getAttribute('aria-expanded') === 'true');

  const visibleMenus = () =>
    [...document.querySelectorAll('[role="menu"]')].filter((m) => m.isConnected && m.getClientRects().length > 0);

  /** Panels that open next to the picker (popovers, overlay panes, dialogs): the menu is not the only thing it may show. */
  const visiblePanels = () =>
    [...document.querySelectorAll('[popover], .cdk-overlay-pane, [role="dialog"]')].filter((el) => el.isConnected && el.getClientRects().length > 0);

  /**
   * The entries of a menu: its own entries, not those of a nested menu and not those that sit inside another entry
   * (an expandable entry holds its options inside itself). For a container that is not a menu, the expanded entry
   * itself, these nested options.
   */
  function menuEntries(container) {
    const items = [...container.querySelectorAll(ITEM_SELECTOR)];
    if (container.getAttribute('role') !== 'menu') return items;
    return items.filter((item) => item.closest('[role="menu"]') === container && !item.parentElement.closest(ITEM_SELECTOR));
  }

  /** An expandable entry (aria-expanded="true") that shows options inside itself instead of opening a submenu. */
  const showsNestedEntries = (item) =>
    item.getAttribute('aria-expanded') === 'true' && [...item.querySelectorAll(ITEM_SELECTOR)].some((el) => el.getClientRects().length > 0);

  /** "Detaillierte Analyse (4 Neon)": the label of an entry with its sublabel; for log messages only. */
  function itemLabel(item) {
    const label = clean(item.querySelector('.label')?.textContent);
    const sub = clean(item.querySelector('.sublabel')?.textContent);
    return label ? (sub ? `${label} (${sub})` : label) : clean(item.textContent);
  }

  /** An entry is locked if it shows a lock icon (<mat-icon fonticon="lock">; the icon name may also be the text). */
  function isLocked(item) {
    for (const icon of item.querySelectorAll('[fonticon], [data-mat-icon-name], mat-icon, gem-icon')) {
      const names = [icon.getAttribute('fonticon'), icon.getAttribute('data-mat-icon-name')];
      if (icon.children.length === 0) names.push(icon.textContent);
      if (names.some((name) => LOCK_ICON.test(clean(name)))) return true;
    }
    return false;
  }

  const isDisabled = (item) => item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled');
  const selectable = (item) => !isLocked(item) && !isDisabled(item);
  const roleOf = (item) => item.getAttribute('role');
  // An entry that opens a submenu: aria-haspopup (<gem-menu-item> with a submenu sets it to "true") or, for an entry
  // that expands, at least aria-expanded. Plain entries carry aria-haspopup="false" and no aria-expanded.
  const hasPopup = (item) => {
    const value = item.getAttribute('aria-haspopup');
    return (value !== null && value !== '' && value !== 'false') || item.hasAttribute('aria-expanded');
  };
  const isChecked = (item) =>
    item.getAttribute('aria-checked') === 'true' || (!item.hasAttribute('aria-checked') && item.classList.contains('selected'));

  /** Models: the selectable radio entries of the picker menu, in menu order (small to large). */
  const modelEntries = (menu) =>
    menuEntries(menu).filter((item) => roleOf(item) === 'menuitemradio' && !hasPopup(item) && selectable(item));

  /** The thinking-effort entry: the last selectable entry that opens a submenu and is not a model itself. */
  const effortTrigger = (menu) =>
    menuEntries(menu)
      .filter((item) => hasPopup(item) && roleOf(item) !== 'menuitemradio' && selectable(item))
      .pop() || null;

  /** Thinking-effort levels: the selectable radio entries of the submenu, in menu order (low to high). */
  function levelEntries(menu) {
    const entries = menuEntries(menu).filter((item) => !hasPopup(item) && selectable(item));
    const radios = entries.filter((item) => roleOf(item) === 'menuitemradio');
    if (radios.length) return radios;
    // Fallback: a list whose entries carry a selection state is an option list as well.
    return entries.some((item) => item.hasAttribute('aria-checked') || item.classList.contains('selected')) ? entries : [];
  }

  /**
   * Compact outline of an element for the debug log: one line per element with tag, role, aria state, test id and
   * own text (and, if asked for, the class names). Logged when the script fails to find its way in a menu, so that
   * the log alone shows what the page looks like.
   */
  function sketch(el, maxLines = 120, withClasses = false) {
    const KEEP = ['role', 'aria-label', 'aria-haspopup', 'aria-expanded', 'aria-checked', 'aria-pressed', 'aria-selected', 'aria-disabled', 'aria-controls', 'data-test-id', 'popover', 'id', 'fonticon'];
    const lines = [];
    const walk = (node, depth) => {
      if (lines.length >= maxLines || depth > 16) return;
      const attrs = KEEP.filter((name) => node.hasAttribute(name)).map((name) => `${name}="${String(node.getAttribute(name)).slice(0, 40)}"`);
      if (withClasses) {
        const classes = clean(node.getAttribute('class')).split(' ').filter((c) => c && !/^(ng-|_ng|mat-mdc|cdk-|mdc-)/.test(c)).slice(0, 6).join(' ');
        if (classes) attrs.push(`class="${classes}"`);
      }
      const own = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => clean(n.textContent)).filter(Boolean).join(' ').slice(0, 40);
      lines.push(`${'  '.repeat(depth)}<${node.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>${own ? ' ' + own : ''}`);
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(el, 0);
    return lines.join('\n');
  }

  /** The picker with everything open next to it, wherever it lives in the page (debug log only). */
  function sketchPicker(maxLines = 120, withClasses = false) {
    const switcher = document.querySelector('bard-mode-switcher');
    const outside = [...visibleMenus(), ...visiblePanels()].filter((el) => !(switcher && switcher.contains(el)));
    return [switcher && sketch(switcher, maxLines, withClasses), ...outside.map((el) => sketch(el, maxLines, withClasses))]
      .filter(Boolean)
      .join('\n---\n');
  }

  /** One line per entry for the debug log: role, state and label (* checked, > submenu). */
  function describeMenu(menu) {
    return menuEntries(menu)
      .map(
        (item) =>
          `${roleOf(item) || '?'}${isChecked(item) ? '*' : ''}${hasPopup(item) ? '>' : ''}${isLocked(item) ? ' [lock]' : ''}` +
          `${isDisabled(item) ? ' [disabled]' : ''} "${itemLabel(item)}"`,
      )
      .join(' | ');
  }

  async function waitFor(fn, timeoutMs, intervalMs = 40) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const value = fn();
      if (value) return value;
      if (Date.now() >= end) return null;
      await sleep(intervalMs);
    }
  }

  // ---------- Styles: hide locked entries, keep the menu invisible while the script works ----------

  const LOCK_MARKS = ['[fonticon="lock"]', '[data-mat-icon-name="lock"]', '[fonticon="lock_outline"]', '[data-mat-icon-name="lock_outline"]'];
  const lockedItems = (scope) => LOCK_MARKS.map((mark) => `${scope} [role^="menuitem"]:has(${mark})`).join(',\n');

  const STYLE = `
${lockedItems('bard-mode-switcher')},
${lockedItems(`[${MENU_ATTR}]`)} {
  display: none !important;
}
html[${BUSY_ATTR}] bard-mode-switcher [popover],
html[${BUSY_ATTR}] bard-mode-switcher gem-menu,
html[${BUSY_ATTR}] [${MENU_ATTR}],
html[${BUSY_ATTR}] [popover]:has([${MENU_ATTR}]) {
  opacity: 0 !important;
  transition: none !important;
  animation: none !important;
}`;

  function installStyles() {
    // 1. The userscript manager's own API: the extension adds the style, so the page's CSP does not apply.
    if (typeof GM_addStyle === 'function') {
      try {
        GM_addStyle(STYLE);
      } catch (_) {
        /* not available after all: the next ways below still apply */
      }
    }
    // 2. A constructed stylesheet is not subject to the page's inline-style CSP either.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (_) {
      /* unsupported or refused (a sandbox may): the inline styles set by hideLockedEntries/styleBusyPopovers take over */
    }
  }

  // The same two rules once more without a stylesheet. A browser or userscript sandbox may refuse the constructed
  // stylesheet (in Firefox a content-script world may not adopt it), and an inline <style> may be blocked by the
  // page's CSP. Inline styles set through the CSSOM are never blocked, so the script also applies the rules itself,
  // from the MutationObserver callback, i.e. before the browser paints the new menu.
  const ownMenus = () => [...document.querySelectorAll(`bard-mode-switcher [role="menu"], [${MENU_ATTR}]`)];

  function hideLockedEntries() {
    for (const menu of ownMenus()) {
      for (const item of menu.querySelectorAll(ITEM_SELECTOR)) {
        if (item.style.display !== 'none' && isLocked(item)) item.style.setProperty('display', 'none', 'important');
      }
    }
  }

  const BUSY_PROPERTIES = ['opacity', 'transition', 'animation'];
  const busyStyled = new Set(); // popovers that carry the inline "invisible" style of the current run
  let busyPanelsBefore = new Set(); // panels that were open when the run began (they are not ours)
  let busyNow = false;

  function styleBusyPopovers() {
    const targets = new Set(document.querySelectorAll('bard-mode-switcher [popover]'));
    for (const menu of ownMenus()) {
      targets.add(menu);
      const popover = menu.closest('[popover]');
      if (popover) targets.add(popover);
    }
    // Whatever panel opens during the run is the picker's, wherever it lives in the page (e.g. the periodic table).
    for (const panel of visiblePanels()) if (!busyPanelsBefore.has(panel)) targets.add(panel);
    for (const el of targets) {
      if (busyStyled.has(el)) continue;
      busyStyled.add(el);
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('animation', 'none', 'important');
    }
  }

  function restoreBusyPopovers() {
    for (const el of busyStyled) for (const property of BUSY_PROPERTIES) el.style.removeProperty(property);
    busyStyled.clear();
  }

  const setBusy = (on) => {
    if (!CFG.hideMenu) return;
    busyNow = on;
    if (on) busyPanelsBefore = new Set(visiblePanels());
    document.documentElement.toggleAttribute(BUSY_ATTR, on);
    if (on) styleBusyPopovers();
    else restoreBusyPopovers();
  };

  /**
   * A submenu may be rendered outside <bard-mode-switcher> (a separate overlay). A menu that an entry of the picker
   * menu controls (aria-controls) belongs to the picker as well: mark it so that the styles apply to it too. Runs in
   * the MutationObserver callback, i.e. before the browser paints the new menu.
   */
  function markPickerMenus() {
    if (!document.querySelector('bard-mode-switcher [aria-expanded="true"]')) return;
    for (const entry of document.querySelectorAll(`bard-mode-switcher [aria-controls], [${MENU_ATTR}] [aria-controls]`)) {
      const target = document.getElementById(entry.getAttribute('aria-controls') || '');
      if (target && target.getAttribute('role') === 'menu' && !target.hasAttribute(MENU_ATTR)) {
        target.setAttribute(MENU_ATTR, '');
      }
    }
  }

  const isPickerUi = (el) => Boolean(el.closest('bard-mode-switcher') || el.closest(`[${MENU_ATTR}]`));

  // ---------- Events for the page's menus ----------

  function fire(el, type, EventCtor, extra) {
    // No `view` member on purpose: in a Firefox userscript sandbox the constructors refuse the sandbox's `window` as
    // the view of an event ("'view' member of UIEventInit does not implement interface Window"), and the page's menus
    // do not need it.
    el.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, composed: true, ...extra }));
  }

  function hover(el) {
    const rect = el.getBoundingClientRect();
    const position = { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) {
      fire(el, type, type.startsWith('pointer') ? PointerEvent : MouseEvent, position);
    }
  }

  function pressKey(el, key) {
    el.focus?.();
    for (const type of ['keydown', 'keyup']) fire(el, type, KeyboardEvent, { key, code: key });
  }

  /**
   * Opens an entry's submenu; tries hover, click and arrow-right until a new menu appears. Returns that menu, or the
   * entry itself if it expanded and shows its options inside itself. Both happen on the real page: a wide window opens
   * "Denkaufwand" in a flyout (hover works), a narrow one expands it in place like an accordion (only the click does).
   */
  async function openSubmenu(item, before) {
    const attempts = [() => hover(item), () => item.click(), () => pressKey(item, 'ArrowRight')];
    for (const act of attempts) {
      if (item.getAttribute('aria-expanded') !== 'true') {
        // already opening: just wait, a click would toggle it shut
        try {
          act();
        } catch (error) {
          log(`${error.name}: ${error.message}`); // an event that cannot be built here: the next way may still work
        }
      }
      const submenu = await waitFor(
        () => visibleMenus().find((m) => !before.has(m)) || (showsNestedEntries(item) ? item : null),
        CFG.stepTimeoutMs / attempts.length,
      );
      if (submenu) return submenu;
    }
    return null;
  }

  /** True while a menu of the picker is open. */
  function menusOpen() {
    const picker = findPicker();
    return (
      Boolean(picker && isPickerOpen(picker)) ||
      visibleMenus().some((menu) => menu.closest('bard-mode-switcher') || menu.hasAttribute(MENU_ATTR))
    );
  }

  /** Closes the menus with Escape (one level per key press). Does nothing, in particular sends no Escape, if none is open. */
  async function closeMenus() {
    for (let i = 0; i < 3 && menusOpen(); i++) {
      try {
        pressKey(document.activeElement || document.body, 'Escape');
      } catch (error) {
        log(`${error.name}: ${error.message}`); // no Escape possible here: the picker click below closes the menu
        break;
      }
      await waitFor(() => !menusOpen(), 400);
    }
    const picker = findPicker();
    if (picker && menusOpen()) picker.click(); // last resort: toggle the menu shut
  }

  /**
   * Opening and closing the menu moves the keyboard focus (into the menu, then back to the picker). Puts it back
   * where it was, but only if it still sits where the menu left it (picker, inside a menu or nowhere); if the user
   * moved it elsewhere in the meantime it is left alone.
   */
  function restoreFocus(previous) {
    const current = document.activeElement;
    const picker = findPicker();
    const leftByMenu =
      !current || current === document.body || current === picker || Boolean(current.closest?.('[role="menu"]'));
    if (!leftByMenu) return;
    if (previous && previous !== document.body && previous.isConnected && typeof previous.focus === 'function') {
      previous.focus({ preventScroll: true });
    } else if (current && current === picker) {
      current.blur(); // nothing had the focus before: do not leave it on the picker
    }
  }

  // ---------- Core logic ----------

  // Besides the list menu the picker can show "The Periodic Table of Gemini": a panel with a "Full table" and a
  // "List view" switch and a tile per model. The script works on the list, so it presses "List view" (an exact match
  // of the whole label, nothing else is ever pressed in that panel; the page remembers the view).
  const LIST_VIEW = /^(list view|listenansicht|liste|vue liste|vista de lista|vista em lista|elenco)$/i;

  /** The picker opened a panel instead of the list menu: press its "List view" switch. Returns the list menu or null. */
  async function switchToListView(panelsBefore, menusBefore) {
    const panels = visiblePanels().filter((panel) => !panelsBefore.has(panel));
    const buttons = panels.flatMap((panel) => [...panel.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"]')]);
    const button = buttons.find((el) => LIST_VIEW.test(clean(el.textContent)));
    if (!button) {
      if (DEBUG) log(t.domOutline(sketchPicker(900, true)));
      return null;
    }
    log(t.switchingView(clean(button.textContent)));
    button.click();
    return waitFor(() => visibleMenus().find((m) => !menusBefore.has(m)), CFG.stepTimeoutMs);
  }

  /**
   * One look at the model menu. Clicks the first thing that is not yet as wanted and returns { changed: true }
   * (the page closes the menu), or closes the menu and returns { changed: false } when the model and the
   * thinking effort are already the best.
   */
  async function applyPass(picker) {
    if (menusOpen()) await closeMenus();
    const before = new Set(visibleMenus());
    const panelsBefore = new Set(visiblePanels());
    picker.click();
    let menu = await waitFor(() => visibleMenus().find((m) => !before.has(m)), CFG.stepTimeoutMs);
    if (!menu) menu = await switchToListView(panelsBefore, before);
    if (!menu) throw new Error(t.errMenuNotOpened);
    await waitFor(() => menuEntries(menu).length > 0, 1000);
    markPickerMenus();
    if (DEBUG) log(t.menuState(describeMenu(menu)));

    const models = modelEntries(menu);
    const best = models[models.length - 1];
    if (!best) {
      if (DEBUG) log(t.domOutline(sketchPicker()));
      throw new Error(t.errNoModel);
    }
    if (!isChecked(best)) {
      const text = itemLabel(best);
      clicks++;
      best.click();
      return { changed: true, what: t.selectedModel(text) };
    }

    const trigger = effortTrigger(menu);
    // `sig` is what the page shows while everything is verified: if the page resets the selection right after the
    // menu closes, the next look sees a different signature and acts again.
    const result = { changed: false, models: models.length, hasEffort: Boolean(trigger), model: itemLabel(best), effort: '', sig: '' };
    if (!trigger) {
      log(t.noEffortMenu);
      result.sig = signature(findPicker() || picker);
      await closeMenus();
      return result;
    }

    const submenu = await openSubmenu(trigger, new Set(visibleMenus()));
    if (!submenu) {
      if (DEBUG) log(t.domOutline(sketchPicker()));
      throw new Error(t.errSubmenuNotOpened(itemLabel(trigger)));
    }
    await waitFor(() => menuEntries(submenu).length > 0, 1000);
    markPickerMenus();
    if (DEBUG) log(t.menuState(describeMenu(submenu)));
    const levels = levelEntries(submenu);
    const top = levels[levels.length - 1];
    if (!top) {
      if (DEBUG) log(t.domOutline(sketch(submenu)));
      throw new Error(t.errNoLevel);
    }
    result.effort = itemLabel(top);
    if (!isChecked(top)) {
      clicks++;
      top.click();
      return { ...result, changed: true, what: t.selectedEffort(result.effort) };
    }
    result.sig = signature(findPicker() || picker);
    await closeMenus();
    return result;
  }

  /** Looks at the menu until nothing is left to change. Returns the last pass, which found everything as wanted. */
  async function applyBest() {
    for (let pass = 1; pass <= CFG.maxPasses; pass++) {
      const picker = findPicker();
      if (!picker) throw new Error(t.errNoPicker);
      const result = await applyPass(picker);
      if (!result.changed) return result;
      log(result.what);
      await waitFor(() => !menusOpen(), CFG.stepTimeoutMs); // the page closes the menu on a click
      await closeMenus();
      await sleep(CFG.settleMs);
    }
    throw new Error(t.errUnstable);
  }

  let busy = false;
  let clicks = 0; // entries clicked during the current attempt (feeds the loop guard)
  let failures = 0; // failed attempts in a row; reset when the picker label or the chat changes
  let thinRuns = 0; // looks at a menu with a single model in a row
  let lastAttemptAt = 0;
  let firstSeenAt = 0; // when the picker first showed up
  let lastTypingAt = 0; // last key press of the user
  let lastSig = ''; // signature of the page at the last look
  let lastDoneSig = null; // signature of the page when everything was last found to be the best
  let userOverride = false; // the user chose in the model menu themselves; lasts until the page is reloaded
  let rerunRequested = false; // a trigger arrived while the menu was being driven
  let switchTimes = []; // timestamps of recent changes (loop guard)
  let pausedUntil = 0;
  let pauseTimer = 0;

  // A new chat is the path /app (or /u/<n>/app); a chat with messages is /app/<id>. Arriving at a new chat means
  // the page may have reset the thinking effort. The picker label shows the effort unless it is the lowest one, so a
  // reset to a higher one is noticed from the label; the lowest is not, hence a new chat is looked at once.
  const NEW_CHAT_PATH = /^\/(?:u\/\d+\/)?app\/?$/;
  let arrivals = 0; // how often a new chat was reached
  let onNewChat = false;
  function noteNavigation() {
    const now = NEW_CHAT_PATH.test(location.pathname);
    if (now && !onNewChat) arrivals++;
    onNewChat = now;
  }

  /** What the script can see of the page's selection without opening the menu. */
  const signature = (picker) => `${pickerLabel(picker)}|${arrivals}`;

  /**
   * Counts attempts that changed something, successful or not; if the page keeps resetting the selection, pauses
   * the script for a while.
   */
  function guardAgainstLoop() {
    const now = Date.now();
    switchTimes = switchTimes.filter((time) => now - time < CFG.loopWindowMs);
    switchTimes.push(now);
    if (switchTimes.length < CFG.loopMax) return;
    switchTimes = [];
    pausedUntil = now + CFG.loopPauseMs;
    log(t.switchLoop(Math.round(CFG.loopPauseMs / 1000)));
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(schedule, CFG.loopPauseMs + 50);
  }

  async function tick() {
    if (busy) {
      rerunRequested = true; // look again as soon as the running sequence is over
      return;
    }
    rerunRequested = false;
    noteNavigation();
    await switchModel();
    if (rerunRequested) schedule();
  }

  async function switchModel() {
    if (busy) return;
    const picker = findPicker();
    if (!picker || !pickerReady(picker)) return;
    if (!firstSeenAt) firstSeenAt = Date.now();

    const sig = signature(picker);
    if (sig !== lastSig) {
      lastSig = sig; // a changed label or a new chat deserves fresh attempts
      failures = 0;
      thinRuns = 0;
    }
    if (sig === lastDoneSig) return;
    if (userOverride || failures >= CFG.maxAttempts || Date.now() < pausedUntil || document.hidden) return;
    const wait = Math.max(firstSeenAt + CFG.startDelayMs, lastAttemptAt + CFG.cooldownMs, lastTypingAt + CFG.typingQuietMs) - Date.now();
    if (wait > 0) {
      scheduleAfter(wait + 50);
      return;
    }

    busy = true;
    lastAttemptAt = Date.now();
    clicks = 0;
    const previousFocus = document.activeElement;
    setBusy(true);
    try {
      const result = await applyBest();
      failures = 0;
      log(t.alreadyBest(result.model, result.effort));
      if (result.models < 2 && !result.hasEffort && ++thinRuns < CFG.thinRuns) {
        log(t.thinMenu); // maybe the page has not loaded all models yet: look again, do not settle
        scheduleAfter(CFG.cooldownMs + 50);
      } else {
        lastDoneSig = result.sig;
      }
    } catch (e) {
      failures++;
      log(t.attemptFailed(failures, e.message));
      await closeMenus();
      scheduleAfter(CFG.cooldownMs + 50); // retry without waiting for the page to change
    } finally {
      if (clicks > 0) guardAgainstLoop();
      await sleep(CFG.settleMs); // let the menu finish closing before it becomes visible again
      restoreFocus(previousFocus);
      setBusy(false);
      busy = false;
    }
  }

  let timer = 0;
  /** Throttled: at most one look per 250 ms, however many DOM changes arrive (the page streams a lot of them). */
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      tick().catch((error) => log(`${error.name}: ${error.message}`)); // never an unhandled rejection in the page's console
    }, 250);
  }

  let laterTimer = 0;
  /** One pending delayed re-check at most, however many triggers arrive meanwhile. */
  function scheduleAfter(ms) {
    clearTimeout(laterTimer);
    laterTimer = setTimeout(schedule, ms);
  }

  // Only real (trusted) events count: the script's own synthetic events are never trusted. This also holds while
  // the script is busy, so a user click during a switch is not lost.
  function onUserInput(event) {
    if (!event.isTrusted) return;
    if (event.type === 'keydown') lastTypingAt = Date.now(); // do not steal the focus while the user types
    const target = event.target instanceof Element ? event.target : null;
    if (target && isPickerUi(target)) {
      userOverride = true; // the user operates the model menu: hands off
      log(t.userSelection);
    }
  }

  function start() {
    installStyles();
    document.addEventListener('pointerdown', onUserInput, true);
    document.addEventListener('keydown', onUserInput, true);
    new MutationObserver(() => {
      markPickerMenus();
      hideLockedEntries();
      if (busyNow) styleBusyPopovers();
      schedule();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true, // the picker label is a text node
      attributes: true,
      attributeFilter: ['aria-label', 'aria-disabled', 'aria-controls', 'aria-expanded'],
    });
    document.addEventListener('visibilitychange', schedule);
    schedule();
    log(t.active);
    // The one line that is always printed: it shows that the script runs at all, and in which mode.
    const version = typeof GM_info === 'object' && GM_info && GM_info.script ? GM_info.script.version : '';
    const mode = typeof GM_addStyle === 'function' ? 'userscript sandbox' : 'page context';
    console.info('[gemini-best-model]', t.loaded(version || 'script', mode, DEBUG));
  }

  // With @run-at document-start <html> may not exist yet: wait for it.
  if (document.documentElement) {
    start();
  } else {
    new MutationObserver((_, observer) => {
      if (document.documentElement) {
        observer.disconnect();
        start();
      }
    }).observe(document, { childList: true });
  }
})();
