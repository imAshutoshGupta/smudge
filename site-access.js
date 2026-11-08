// Smudge — "Keep blurs on this site": the plumbing shared by the popup and the
// background worker. Plain script, no modules: the popup loads it with a
// <script> tag and the worker with importScripts.
//
// What "keeping" a site means, end to end:
//   1. The person grants host access to that one site (optional permission,
//      Chrome asks). Nothing here ever asks for more than that site.
//   2. Smudge's content scripts are registered for that site only, so they
//      run again on every page of it. The registration is not persisted, so
//      it ends when the browser closes.
//   3. What to restore lives in chrome.storage.session — memory only, never
//      written to disk, wiped when the browser closes.
//
// Storage layout (all in chrome.storage.session):
//   "site|<origin>"            { keep, scanned, enabled[], revealedTypes[] }
//   "page|<origin>|<pageKey>"  { blurs: [{ id, sel, fp }], reveals: [fp] }
//
// `sel` is a CSS path to an element the person clicked to blur, and `fp` a
// short hash of its text. The text itself is never stored.

// `var` rather than `const`: a const at the top level of one classic script
// is not a property of the global object, and a second load would throw.
var SmudgeSites = (() => {
  const SCRIPT_FILES = [
    "content/detectors.js",
    "content/redactor.js",
    "content/keep.js",
    "content/index.js",
  ];

  const siteKey = (origin) => "site|" + origin;
  const pagePrefix = (origin) => "page|" + origin + "|";

  // Only ordinary websites. file:// would need the separate "Allow access to
  // file URLs" switch, and keeping blurs on a local file is not what this is for.
  function canKeep(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  }

  // Chrome match patterns can't name a port, so one grant covers every port
  // of a host. Storage stays keyed on the full origin, so localhost:3000 and
  // localhost:8000 still keep separate blurs.
  function patternFor(origin) {
    const u = new URL(origin);
    return `${u.protocol}//${u.hostname}/*`;
  }

  const scriptIdFor = (pattern) => "keep " + pattern;

  async function getSite(origin) {
    try {
      const key = siteKey(origin);
      return (await chrome.storage.session.get(key))[key] || null;
    } catch {
      return null;
    }
  }

  async function updateSite(origin, patch) {
    const current = await getSite(origin);
    if (!current || !current.keep) return; // only a kept site has a record
    await chrome.storage.session.set({ [siteKey(origin)]: { ...current, ...patch } });
  }

  async function register(pattern) {
    const id = scriptIdFor(pattern);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (existing.length) return;
    try {
      await chrome.scripting.registerContentScripts([
        {
          id,
          matches: [pattern],
          js: SCRIPT_FILES,
          // As early as possible, so blurs go on while the page is still
          // arriving rather than after it has been drawn.
          runAt: "document_start",
          allFrames: true,
          // Ends with the browser, same as the blurs it restores.
          persistAcrossSessions: false,
        },
      ]);
    } catch (err) {
      // Two enables racing for the same site — the other one won.
      if (!/duplicate script id/i.test(String(err && err.message))) throw err;
    }
  }

  async function unregister(pattern) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(pattern)] });
    } catch {
      // Not registered — nothing to undo.
    }
  }

  function originsIn(all) {
    return Object.keys(all)
      .filter((k) => k.startsWith("site|"))
      .map((k) => k.slice("site|".length));
  }

  // Forget one site: its record, every page under it, the registration and
  // the host access — unless another origin on the same host (a different
  // port) is still being kept, since they share the grant.
  async function forget(origin) {
    let all = {};
    try {
      all = await chrome.storage.session.get(null);
    } catch {
      // Storage unreachable — still drop the access below.
    }
    const prefix = pagePrefix(origin);
    const keys = Object.keys(all).filter(
      (k) => k === siteKey(origin) || k.startsWith(prefix)
    );
    if (keys.length) await chrome.storage.session.remove(keys);

    const pattern = patternFor(origin);
    const shared = originsIn(all).some(
      (o) => o !== origin && patternFor(o) === pattern
    );
    if (shared) return;
    await unregister(pattern);
    try {
      await chrome.permissions.remove({ origins: [pattern] });
    } catch {
      // Already gone.
    }
  }

  // The person took access away (chrome://extensions, or we did). Forget
  // every origin that grant covered.
  async function forgetPattern(pattern) {
    await unregister(pattern);
    let all = {};
    try {
      all = await chrome.storage.session.get(null);
    } catch {
      return;
    }
    const keys = [];
    for (const origin of originsIn(all)) {
      if (patternFor(origin) !== pattern) continue;
      keys.push(siteKey(origin));
      for (const k of Object.keys(all)) {
        if (k.startsWith(pagePrefix(origin))) keys.push(k);
      }
    }
    if (keys.length) await chrome.storage.session.remove(keys);
  }

  return {
    SCRIPT_FILES,
    siteKey,
    pagePrefix,
    canKeep,
    patternFor,
    getSite,
    updateSite,
    register,
    forget,
    forgetPattern,
  };
})();
