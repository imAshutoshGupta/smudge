// Smudge — background worker. Its one job is "Keep blurs on this site":
// switching it on and off for a site, and making sure nothing outlives the
// browser session. It never looks at page content; the content scripts do
// that, inside the page, exactly as before.

importScripts("site-access.js");

const S = SmudgeSites;

// Content scripts read and write the remembered blurs directly. Session
// storage is closed to them unless opened up, and the setting doesn't
// survive a browser restart, so set it every time the worker starts.
async function openSessionStorage() {
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
  } catch {
    // Older Chrome — the manifest's minimum version rules this out.
  }
}
openSessionStorage();

// Keeping lasts until the browser closes. Session storage and the
// registrations already go on their own, but a granted host permission
// would survive the restart — drop it, so a site has to be switched on
// again, by the person, in a new session.
async function dropLeftovers() {
  try {
    await chrome.scripting.unregisterContentScripts();
  } catch {
    // Nothing registered.
  }
  try {
    const { origins = [] } = await chrome.permissions.getAll();
    if (origins.length) await chrome.permissions.remove({ origins });
  } catch {
    // Nothing granted.
  }
}
chrome.runtime.onStartup.addListener(dropLeftovers);
chrome.runtime.onInstalled.addListener(dropLeftovers);

// Inject (a no-op where the scripts already run) and return every frame
// that answered. Frames on other sites can't be reached, and are skipped.
async function frameIdsOf(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: S.SCRIPT_FILES,
    });
    return results.map((r) => r.frameId);
  } catch {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: S.SCRIPT_FILES,
    });
    return results.map((r) => r.frameId);
  }
}

async function ask(tabId, frameId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    return null;
  }
}

// One enable per origin at a time: the popup asks, and the permission
// listener below may ask for the same site a moment later.
const enabling = new Map();

function enableSite(tabId, origin) {
  if (enabling.has(origin)) return enabling.get(origin);
  const job = doEnable(tabId, origin).finally(() => enabling.delete(origin));
  enabling.set(origin, job);
  return job;
}

async function doEnable(tabId, origin) {
  const pattern = S.patternFor(origin);
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
    throw new Error("Smudge wasn't given access to this site.");
  }
  await openSessionStorage();

  // Start from what is already on the page: if it was scanned before the
  // switch went on, every later page should be scanned too.
  const frameIds = await frameIdsOf(tabId);
  const states = await Promise.all(
    frameIds.map((id) => ask(tabId, id, { type: "GET_STATE" }))
  );
  const answered = states.filter((s) => s && s.ok);
  const scannedFrame = answered.find((s) => s.scanned);
  const top = states[frameIds.indexOf(0)];
  const site = {
    keep: true,
    scanned: !!scannedFrame,
    enabled: scannedFrame ? scannedFrame.enabled : [],
    revealedTypes: (top && top.ok && top.revealedTypes) || [],
  };

  await chrome.storage.session.set({ [S.siteKey(origin)]: site });
  await S.register(pattern);
  // Each frame saves what it already has blurred and starts watching.
  await Promise.all(
    frameIds.map((id) => ask(tabId, id, { type: "KEEP", on: true, origin }))
  );
  return site;
}

async function disableSite(tabId, origin) {
  if (tabId != null) {
    // Every frame stops saving. The blurs on screen stay until Clear all.
    try {
      await chrome.tabs.sendMessage(tabId, { type: "KEEP", on: false });
    } catch {
      // Tab gone — nothing to tell.
    }
  }
  await S.forget(origin);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only Smudge's own pages (the popup) talk to the worker. Content scripts
  // run inside websites and have no business here.
  const own = chrome.runtime.getURL("");
  if (sender.id !== chrome.runtime.id || !String(sender.url || "").startsWith(own)) {
    return false;
  }
  const run = async () => {
    switch (msg && msg.type) {
      case "KEEP_ON":
        return { ok: true, site: await enableSite(msg.tabId, msg.origin) };
      case "KEEP_OFF":
        await disableSite(msg.tabId, msg.origin);
        return { ok: true };
      default:
        return { ok: false, error: "unknown message" };
    }
  };
  run().then(sendResponse, (err) =>
    sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true;
});

// Chrome's permission dialog can close the popup before it hears the answer.
// If access was granted for the site in the active tab and the popup never
// followed up, finish switching it on from here.
chrome.permissions.onAdded.addListener(async ({ origins = [] }) => {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    return;
  }
  if (!tab || !S.canKeep(tab.url)) return;
  const origin = new URL(tab.url).origin;
  if (!origins.includes(S.patternFor(origin))) return;
  // Give the popup a moment to do it itself.
  await new Promise((r) => setTimeout(r, 1500));
  const site = await S.getSite(origin);
  if (site && site.keep) return;
  try {
    await enableSite(tab.id, origin);
  } catch {
    // The popup will show the switch as off; the person can try again.
  }
});

// Access taken away — from chrome://extensions, or by us when forgetting.
chrome.permissions.onRemoved.addListener(async ({ origins = [] }) => {
  for (const pattern of origins) await S.forgetPattern(pattern);
});
