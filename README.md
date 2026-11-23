**English** | [Deutsch](README.de.md)

# Gemini: automatically pick the best model and the highest thinking effort

Tampermonkey userscript for `https://gemini.google.com/app`. It selects the **best model available to you** (the
lowest unlocked entry of the model picker) and the **highest available thinking effort** ("Denkaufwand" in the German
UI). Menu entries with a **lock icon** are hidden.

## Installation

1. Install Tampermonkey in your browser (Chrome, Edge or Firefox).
2. Tampermonkey dashboard → "Create a new script" → paste the content of `gemini-best-model.user.js` → save.
3. Reload `https://gemini.google.com/app`.

## Behavior

- **Model:** The picker menu lists its models from small to large (Automatic first). Of all selectable entries
  (radio entries that are neither locked nor disabled) the **last** one is chosen. If a new model is added at the
  bottom later, the script follows without changes. If the only selectable entry is "Automatic" (signed out, or no
  paid plan), nothing is changed.
- **Thinking effort:** The model menu ends with an entry that opens a submenu. The script recognises it by its
  structure (an entry with a submenu that is not a model), not by its label, so it works in every UI language. In the
  submenu the **last selectable** entry is chosen (today: "Hoch"). Models without such an entry are fine, too.
- **Locked entries are hidden:** Every entry of the picker menu (and of its submenu) that shows a lock icon is hidden,
  so it cannot be picked by accident. This is done twice over: by a constructed stylesheet and, in case the browser or
  the userscript sandbox refuses that (Firefox content-script worlds may), by inline styles the script sets itself
  before the menu is painted. The script never clicks a locked or disabled entry, and never the "Anmelden" (sign in)
  entry.
- **Two layouts of the picker:** Under the input (wide window) and in the header (narrow window, shown as "Gemini
  Neon"). Both open the same list menu; only the picker button is marked differently (in the header the test id sits
  on the `<gem-button>` around the `<button>`, and the button has no `aria-haspopup` / `aria-expanded`). The script
  handles both. The header label shows the thinking effort just like the one under the input ("Neon Hoch"). The two
  layouts also differ in how "Denkaufwand" shows its options: in a wide window they open in a flyout next to the menu
  (on hover), in a narrow window (seen at 640 px and 870 px) the entry expands in place like an accordion (on a
  click) and its options sit inside the entry. The script reads both; in the narrow layout it tries hover first, so
  each look costs about a second more. A phone (measured at 360 px with the mobile page, signed out) uses the header
  layout: the same list menu in a popover, not a bottom sheet. A screenshot of Firefox on Android (signed in) shows
  the accordion form of "Denkaufwand" there. See "Phone" under Troubleshooting for what is and is not known.
- **Two views of the picker:** Besides the list menu, the picker can show "The Periodic Table of Gemini" (a panel with
  the switches "Full table" and "List view" and a tile per model). The script works on the list: if the panel appears,
  it presses "List view" (an exact match of the whole label; nothing else in the panel is ever clicked, no tile, no
  "Unlock") and goes on. The page remembers the view. If the panel has no such switch, the script does nothing in it
  and the debug log carries an outline of the panel.
- **Order and verification:** The script opens the model menu, reads the check marks and clicks the first entry that is
  not yet as wanted. The page closes the menu on a click, so the script looks again: model first (changing the model
  may reset the thinking effort), then the thinking effort, then a final look to verify. If everything is already as
  wanted, nothing is clicked.
- **When it runs:** once after the page has loaded, whenever the picker label changes (the page or someone else changed
  the model or the thinking effort: the label shows both, e.g. "Neon Hoch", the effort only while it is not the
  lowest), and whenever you open a **new chat** (the path becomes `/app` again). A new chat is looked at once to be
  sure, because the lowest effort is not part of the label. Sending the first message of a chat (`/app` becomes
  `/app/<id>`) does not open the menu.
- **Your own choice wins:** If you operate the model menu yourself (real click or key press, also in the middle of an
  automatic run), the script does not touch it again until the page is reloaded. A new chat does not lift this.
  Reload the page to get the best model and effort again.
- **Safety nets:** If the page keeps resetting the selection (5 attempts that clicked something within 30 s), the
  script pauses for 2 minutes. After 5 failed attempts in a row it gives up until the picker label or the chat
  changes. A menu with a single model may be an unfinished page, so it is looked at three times before the script
  settles.
- **Typing:** The menu is never opened within 1.5 s after one of your key presses, so it cannot swallow what you type.
- **Focus:** After a run, keyboard focus returns to where it was before (usually the input field). Escape is only sent
  while a menu is open.
- **No flicker:** The menu is invisible while the script works.
- **Debug:** `localStorage.setItem('gemini-best-model-debug', '1')` in the console, then reload the page. The log shows
  every menu the script sees (`*` checked, `>` opens a submenu, `[lock]`, `[disabled]`). If the script cannot find its
  way (no submenu, no selectable entry), the log also carries a compact outline of the picker and its menus, so a bug
  report needs nothing but the lines starting with `[gemini-best-model]`. Menu labels are logged, chat content never.
- **Log panel (for a phone, which has no console):** Open `https://gemini.google.com/app?gbm-debug` in a **new tab**
  (the script reads the address when the page loads; a server may turn `?gbm-debug` into `?gbm-debug=`, both work).
  The script then shows its log in a panel at the bottom edge of the page: the loaded line, the environment (user
  agent, window size, touch, userscript manager, whether the browser knows `:has()`), whether the picker was found,
  every menu it sees and what it clicked. "Copy log" copies the text (or select it by hand), "Turn off" removes the
  setting, "Close" hides the panel until the next load. `?gbm-debug=off` switches it off as well. The setting stays
  until then. The log carries menu labels and technical details of the device, no chat content.

## Troubleshooting

- **Nothing happens:** A userscript manager injects a script only when a page loads, so reload the page (on a phone:
  open it afresh) after installing or updating the script; a tab that was already open stays untouched. Then open the
  browser console and look for the line `[gemini-best-model] <version> loaded (...)`. The
  script prints it once per page load, without any switch. If it is missing, the script does not run on the page
  (Tampermonkey icon: is the script listed and enabled for the tab?). If it is there, set the debug flag (see Debug),
  reload and read the log: it names the step that failed.
- **Phone (Firefox on Android), no console:** First reload as above, then check in the userscript manager's menu, with
  the Gemini tab open, that this script is listed for the page, enabled, and which version it is (the log panel needs
  1.0.5 or newer). Then open the page with `?gbm-debug` as described under Debug. **No panel at all:** the script does not run on the
  page: manager, match pattern or version, not the picker. **Panel there:** read it; the first lines say whether the
  picker was found, and after about 10 s "no usable model picker" names what the script sees instead. Copy the log
  into a bug report.
- **`@grant GM_addStyle`, not `@grant none`:** With `none` a userscript manager injects the script into the page as an
  inline `<script>`, which the strict Content-Security-Policy of Gemini blocks in Firefox (privacy extensions make this
  worse). With a grant the manager runs the script in its own sandbox, which no page policy can block. The script needs
  only the DOM, events and `localStorage`, which the sandbox shares with the page; the tests run it in the page's world
  and in an isolated world.

## Verification status

Measured on the real Gemini page on 2026-11-23, **signed out** (German UI): picker
(`bard-mode-switcher`, `data-test-id="bard-mode-menu-button"`), menu (`gem-menu role="menu"` in a popover), model
entries (`gem-menu-item role="menuitemradio"`, `aria-checked`, `aria-disabled`, lock icon `fonticon="lock"`), the "Anmelden"
entry. The E2E test checks the script against exactly this page. A saved copy of the signed-in page (menu closed)
shows the same picker markup; the label sits in `span.picker-primary-text`. A real console log of the script
(Firefox, Tampermonkey, signed in, 2026-11-23) shows the list menu read correctly: four radio entries (Automatic,
Hilfe im Alltag, Detaillierte Analyse selected, Code und komplexe Aufgaben locked but **not** `aria-disabled`, which is
why locking is detected by the icon) and "Denkaufwand" as an entry with a submenu. That log also showed that a
Firefox userscript sandbox refuses a `view` member in synthetic events; the script builds its events without one. The thinking-effort submenu exists only
for signed-in users and opens only with the menu; it is covered by the mock page (built from the same markup and from
the behavior of the page's menu component) and by the signed-in part of the E2E test when a profile is available (see
below). The automated tests run in Chromium; Tampermonkey in Firefox is not covered by them.

**Live check, narrow window** (Firefox responsive mode at about 870 px, script 1.0.4): the picker in the header was
found and the same flow ran through (effort chosen, verification pass "already the best"); the header read
"Neon Hoch". **Live check, wide window** (Firefox, Tampermonkey, signed in, script 1.0.3, 2026-11-23): the script opened the thinking-effort
submenu (entries "Niedrig (Schnell und effizient)", "Mittel (Ausgewogener Tiefgang)", "Hoch (Besonders gründlich)"),
chose "Hoch", and its verification pass found model and effort as wanted. The picker then read "Neon Hoch".
**Hiding confirmed:** a screenshot of the open menu in Firefox (signed in, narrow window, 640 px) lacks the locked
entry "Code und komplexe Aufgaben"; the menu shows Automatic, "Hilfe im Alltag" and "Detaillierte Analyse" and
"Denkaufwand" with "Hoch" ticked.

**Phone:** The picker and its menu at 360 px width with the user agent of Firefox on Android were measured on the real
page, signed out (Chromium with touch and device pixel ratio 3 as the stand-in): the picker sits in the header, the
menu is the same `gem-menu` popover inside `bard-mode-switcher`, and the script runs through there in the E2E test
(picker found, menu read, locked entries hidden, nothing clicked, menu closed again). **Live check, Firefox on Android**
(signed in, 2026-11-23): after the page was opened afresh the header read "Neon Hoch", so the model and the thinking
effort were set. An earlier check on the same phone (script 1.0.4) had shown the effort at "Niedrig" and the locked
entry "Code und komplexe Aufgaben" still visible. Hiding is done by the stylesheet whenever the script runs, so the
script most likely had not run on that page at all; the cause was not established, and which version ran in the second
check was not recorded. Version 1.0.5 adds the log panel for cases like this (see Debug). **Firefox on Android itself
is not covered by any automated test.**

## Code and localization

The script's code (identifiers, comments) is English. Texts exist in English and German:

- **Tampermonkey header:** `@name`/`@description` in English, `@name:de`/`@description:de` in German.
- **Console messages (debug):** `MESSAGES` table in the script, language chosen by `navigator.language`. German gets
  German texts, every other language gets English.
- **Other UI languages:** Nothing in the detection depends on the UI language (picker: `data-test-id`; thinking
  effort: structure; lock: icon name).

## Tests (Chrome or Edge + Playwright)

```sh
npm install
npm test            # menu test (mock page) and E2E test (real page)
npm run test:menu   # mock page only: rules, hiding, focus, new chat, own choice, typing, loop guard, retry
npm run test:e2e    # real page: signed out (throw-away profile; wide, narrow and phone window; log panel) and, if available, signed in
node tools/probe.mjs --viewport=870x600   # dump the picker and its menus of the real page (any window size)
node tools/probe.mjs --mobile             # the same as a phone: 360x780, touch, user agent of Firefox on Android
npm run login       # one-off: opens a browser window to sign in to Google, saves the session for the E2E test
```

The menu test needs no account. Its mock page reproduces the markup of the picker as measured on the real page and a
thinking-effort submenu, including the behavior the script depends on (top-layer popover, focus moves into the menu
and back, Escape closes one level, a disabled entry swallows the click). It also runs the page as a phone (touch, 360
px, user agent of Firefox on Android) and covers the log panel. `ONLY=<regex>` runs single scenarios, `VERBOSE=1`
prints state and script log for passed checks.

The E2E test loads the script as an init script (Tampermonkey itself does not run in the test; the script uses no
`GM_*` API). Signed out it runs in a throw-away profile. The signed-in part runs if `npm run login` has created the
profile `.profile/` and sets the lowest effort by hand first; it never sends a message, but it does change the model
and effort selection of that account, which is what the script is for.

`npm run login` opens an ordinary browser window with its own profile (`.profile/`, not your normal profile, sync
disabled). Sign in to Google there and close the window once Gemini shows your account; the script then reads the
profile's cookies and saves them to `.auth/gemini-state.json`. It must be an ordinary window: Chrome sets
`navigator.webdriver = true` as soon as a remote debugging port is open (measured with Chrome 158), and a browser
started by Playwright does so as well; Google then refuses the sign-in ("This browser or app may not be secure").
Playwright touches the profile only after the window is closed, when the session already exists.
`npm run login:finish` only saves the session of a profile that already holds one. This sign-in flow has not been run
to completion yet: the first attempts were refused for the reason above, and the live check was done in Firefox
instead. **`.profile/` and `.auth/` hold a
live Google session. They are git-ignored; never commit or share them.** The browser is Chrome by default (a fresh
Edge profile can sign in with the Windows account on its own and start a sync); set `GEMINI_BROWSER_EXE` /
`GEMINI_BROWSER_CHANNEL` for another one.

## License

[MIT](LICENSE)
