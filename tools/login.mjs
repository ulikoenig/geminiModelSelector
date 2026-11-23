// Opens a normal Chrome window with the test profile (.profile/) so that you can sign in to Google by hand. When you
// close the window, the script checks that the profile holds a Google session and saves its cookies to
// .auth/gemini-state.json for the tests.
//
// Why an ordinary window: Chrome sets navigator.webdriver = true as soon as a remote debugging port is open (measured
// with Chrome 158, even with no client attached), and a browser started by Playwright does so as well. Google then
// refuses the sign-in ("This browser or app may not be secure", .../v3/signin/rejected). So the window is a plain
// Chrome with its own profile and sync disabled. Playwright only touches the profile afterwards, once the window is
// closed, to read the cookies; an existing session keeps working there.
//
// .profile/ and .auth/ hold a live Google session: both are git-ignored, never commit or share them. The script
// prints cookie NAMES and counts, never values.
//
// Usage:  node tools/login.mjs            open the window, wait until you close it, then save the session
//         node tools/login.mjs --finish   only save the session of the profile (the window must be closed)
//
// Close the window only when Gemini shows your account (profile picture at the top right). If Chrome asks whether to
// sign in to Chrome or to save the password, decline.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { authDir, browserChannel, browserExe, profileDir, stateFile } from './paths.mjs';

const START_URL = 'https://gemini.google.com/app';
const MAX_MS = 9.5 * 60_000;
// A completed Google sign-in sets at least one of these cookies; anonymous visitors never get them.
const SESSION_COOKIES = ['SID', '__Secure-1PSID', '__Secure-3PSID'];

const log = (...args) => console.log(new Date().toLocaleTimeString('de-DE'), ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isGoogle = (cookie) => cookie.domain.replace(/^\./, '').endsWith('google.com');
const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

fs.mkdirSync(profileDir, { recursive: true });
fs.mkdirSync(authDir, { recursive: true });

if (!process.argv.includes('--finish')) {
  const child = spawn(
    browserExe,
    [`--user-data-dir=${profileDir}`, '--disable-sync', '--no-first-run', '--no-default-browser-check', START_URL],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  let exited = false;
  child.on('exit', () => (exited = true));
  await sleep(4000);
  if (exited) {
    // Chrome hands a second start with the same profile over to the running instance and exits at once.
    log('The browser exited immediately: a window with this profile is probably already open. Close it and start again.');
    process.exit(1);
  }
  log('Browser window opened. Sign in to Google there; close the window when Gemini shows your account.');
  const deadline = Date.now() + MAX_MS;
  while (isRunning(child.pid) && Date.now() < deadline) await sleep(1000);
  if (isRunning(child.pid)) {
    log('Time limit reached. The window stays open; close it when you are done and run: node tools/login.mjs --finish');
    process.exit(1);
  }
  log('Window closed.');
}

// Read the cookies with Playwright, which is fine now: the window is closed and the session already exists.
let context = null;
for (let attempt = 1; attempt <= 8 && !context; attempt++) {
  try {
    context = await chromium.launchPersistentContext(profileDir, { channel: browserChannel, headless: true, locale: 'de-DE' });
  } catch (error) {
    if (attempt === 8) {
      log(`The profile cannot be opened: ${String(error.message).split('\n')[0]}`);
      process.exit(1);
    }
    await sleep(3000); // the browser may still be shutting down
  }
}
try {
  const cookies = await context.cookies();
  const session = cookies.filter((c) => isGoogle(c) && SESSION_COOKIES.includes(c.name) && c.value);
  if (!session.length) {
    log(`No Google sign-in found in the profile (google.com cookies: ${cookies.filter(isGoogle).map((c) => c.name).join(', ') || 'none'}). Nothing saved.`);
    process.exitCode = 1;
  } else {
    await context.storageState({ path: stateFile });
    log(`Sign-in found (session cookies: ${session.map((c) => c.name).join(', ')}).`);
    log(`Session saved: ${cookies.length} cookies (${cookies.filter(isGoogle).length} for google.com) -> ${path.relative(process.cwd(), stateFile) || stateFile}`);
  }
} finally {
  await Promise.race([context.close(), sleep(8000)]).catch(() => {});
}
process.exit(process.exitCode ?? 0);
