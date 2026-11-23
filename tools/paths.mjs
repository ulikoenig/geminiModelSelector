// Shared paths for the tools and tests.
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
// Browser profile with the signed-in Google session (git-ignored, never commit or share it).
export const profileDir = path.join(root, '.profile');
export const authDir = path.join(root, '.auth');
// Cookies of the signed-in session in Playwright's storageState format (git-ignored as well).
export const stateFile = path.join(authDir, 'gemini-state.json');
// Screenshots and dumps (git-ignored, may contain chat titles).
export const outDir = path.join(root, 'out');
// Chrome is used for the signed-in profile: Google's sign-in works best there, and unlike Edge it does not sign the
// fresh profile in to the Windows account (single sign-on) and start a sync on its own.
export const browserChannel = process.env.GEMINI_BROWSER_CHANNEL || 'chrome';
export const browserExe = process.env.GEMINI_BROWSER_EXE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
