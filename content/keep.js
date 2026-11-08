// Smudge — "Keep blurs on this site". Remembers what was blurred on each page
// of a site and puts it back when the person returns, whether the site loads
// a fresh page each time or swaps content in place (a single-page app).
//
// Off unless the person switched it on for this site in the popup. When it
// is off, nothing in here touches the page or storage.
//
// What is remembered, per page, in chrome.storage.session (memory only,
// never written to disk, gone when the browser closes):
//   - each element clicked to blur: a CSS path to it and a hash of its text
//   - each detected item clicked to reveal: a hash of its type and text
// The text itself is never stored. The hash is only there to tell whether
// the element in that spot is still the one that was blurred. Short values
// like phone numbers could be guessed back from a hash by someone who
// already has access to this browser's memory, which is why it stays there.
//
// Restoring runs from a MutationObserver started at document_start. Its
// callback runs as each piece of the page is parsed, and before the browser
// draws it, so blurs go on top to bottom as the page arrives instead of
// after it has finished loading.

(() => {
  const S = (window.Smudge = window.Smudge || {});
  if (S.keep) return;

  const ORIGIN = location.origin;
  const SITE_KEY = "site|" + ORIGIN;
  const PAGE_PREFIX = "page|" + ORIGIN + "|";

  let active = false;
  let pages = new Map(); // pageKey -> { blurs: [{ id, sel, tag, fp }], reveals: [fp] }
  let pageKey = null;
  let page = null;
  let revealSet = new Set();

  // Marks this frame's own writes, so the storage event that echoes them back
  // isn't mistaken for news from another tab and doesn't overwrite a click
  // made in the meantime.
  const WRITER = Math.random().toString(36).slice(2);

  // Which element each saved blur is on right now. A "weak" match is the
  // element at the saved path whose text has changed (a timestamp ticked
  // over, say). It is blurred anyway — for a screen share, blurring one
  // thing too many is the safe mistake — until something with the right
  // text turns up.
  const live = new Map(); // entry id -> element
  const weak = new Set(); // entry ids matched only by path
  // How often each entry has searched for its text and come up empty. On a
  // page that never stops changing, give up after a while rather than keep
  // reading text out of the page every 200 ms.
  const misses = new Map(); // entry id -> count
  const MAX_SEARCHES = 25;

  let observer = null;
  let rootObserver = null;
  let settleTimer = 0;

  // -------------------------------------------------------------------------
  // Hashing and paths
  // -------------------------------------------------------------------------

  // cyrb53: a small, fast, non-cryptographic 53-bit hash. Synchronous, which
  // matters — it runs inside the observer, before the page is drawn.
  function hash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }

  function textOf(el) {
    let text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text && el.tagName === "IMG") text = el.getAttribute("alt") || el.getAttribute("src") || "";
    return text;
  }

  const fingerprint = (el) => hash(el.tagName + "|" + textOf(el));

  // Detected items: the type and the matched text, or a field's value.
  function revealFp(el) {
    const type = el.dataset.smudgeType || "";
    const text = el.classList.contains("smudge-field") ? el.value : el.textContent;
    return hash(type + "|" + (text || ""));
  }

  // Which "page" this is. The query counts (/orders?id=5 is not /orders?id=6).
  // A #fragment only counts when it looks like an app route (#/settings,
  // #!/inbox) — a jump to a heading is still the same page.
  function currentPageKey() {
    const hashPart = /^#[!/]/.test(location.hash) ? location.hash : "";
    return location.pathname + location.search + hashPart;
  }

  // An id worth anchoring on: unique, and not one a framework generated
  // (those change on every load — React's :r1:, ember123, a run of digits).
  function stableId(el) {
    const id = el.id;
    if (!id || !/^[A-Za-z][\w-]*$/.test(id) || /\d{3,}/.test(id)) return false;
    try {
      return document.querySelectorAll("#" + CSS.escape(id)).length === 1;
    } catch {
      return false;
    }
  }

  // A CSS path from the nearest stable id (or <body>) down to el. Each step
  // counts same-tag siblings *other than our own wrapper spans*
  // (:nth-child(k of …), Chrome 111+), so the path still holds whether or not
  // the detected items around it have been wrapped yet.
  function selectorFor(el) {
    const steps = [];
    let node = el;
    while (node && node !== document.body) {
      if (node.nodeType !== Node.ELEMENT_NODE || node === document.documentElement) return null;
      if (stableId(node)) {
        steps.unshift("#" + CSS.escape(node.id));
        return steps.join(" > ");
      }
      const parent = node.parentElement;
      if (!parent) return null;
      const tag = CSS.escape(node.localName);
      let k = 0;
      for (const sib of parent.children) {
        if (sib.localName === node.localName && !sib.classList.contains("smudge-auto")) k++;
        if (sib === node) break;
      }
      steps.unshift(`${tag}:nth-child(${k} of ${tag}:not(.smudge-auto))`);
      node = parent;
    }
    if (node !== document.body) return null; // inside <head>, or detached
    steps.unshift("body");
    return steps.join(" > ");
  }

  function query(sel, root = document) {
    try {
      return root.querySelector(sel);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Storage (memory only — chrome.storage.session)
  // -------------------------------------------------------------------------

  function emptyPage() {
    return { blurs: [], reveals: [] };
  }

  function loadPages(all) {
    pages = new Map();
    for (const [k, v] of Object.entries(all || {})) {
      if (k.startsWith(PAGE_PREFIX) && v) pages.set(k.slice(PAGE_PREFIX.length), v);
    }
  }

  // Always a write, even of an empty page, never a removal: a removal can't
  // carry the WRITER mark, so its echo would wipe a click made since. The
  // whole site's keys go together when it is forgotten.
  function savePage(key) {
    const p = pages.get(key);
    if (!p) return;
    try {
      chrome.storage.session
        .set({ [PAGE_PREFIX + key]: { blurs: p.blurs, reveals: p.reveals, by: WRITER } })
        .catch(() => {});
    } catch {
      // Extension reloaded under us — the page keeps its blurs, just not
      // remembered.
    }
  }

  function newId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // Remember a blur the person just made, and mark the element as ours.
  function newEntry(el, sel) {
    const entry = { id: newId(), sel, tag: el.localName, fp: fingerprint(el) };
    claim(el, entry, false);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Restoring manual blurs
  // -------------------------------------------------------------------------

  // An element another saved blur is surely on. A weak hold doesn't count:
  // a sure match may take the element over.
  function heldSurely(el, id) {
    const owner = el.dataset.smudgeSaved;
    return !!owner && owner !== id && !weak.has(owner);
  }

  function claim(el, entry, isWeak) {
    const prev = el.dataset.smudgeSaved;
    if (prev && prev !== entry.id) {
      // Taking it over from a weak hold; that entry goes back to looking.
      live.delete(prev);
      weak.delete(prev);
    }
    el.classList.add("smudge-blur", "smudge-manual-blur");
    el.dataset.smudgeSaved = entry.id;
    live.set(entry.id, el);
    if (isWeak) weak.add(entry.id);
    else weak.delete(entry.id);
  }

  function release(id) {
    const el = live.get(id);
    live.delete(id);
    weak.delete(id);
    if (el && el.dataset.smudgeSaved === id) {
      el.classList.remove("smudge-blur", "smudge-manual-blur");
      delete el.dataset.smudgeSaved;
    }
  }

  // The element this entry is on now, if it still is.
  function current(entry) {
    const el = live.get(entry.id);
    if (el && el.isConnected && el.dataset.smudgeSaved === entry.id) {
      // A framework rewrote the class attribute — put the blur back.
      if (!el.classList.contains("smudge-blur")) el.classList.add("smudge-blur", "smudge-manual-blur");
      return el;
    }
    live.delete(entry.id);
    weak.delete(entry.id);
    return null;
  }

  // Look near the saved path for an element of the same tag with the same
  // text — the layout moved, but the thing that was blurred is still here.
  // Searches the saved path's parent, or the nearest ancestor of it that
  // still exists, up to three levels.
  function findByFingerprint(entry) {
    if (!entry.tag) return null;
    let parentSel = entry.sel;
    for (let up = 0; up < 3; up++) {
      const cut = parentSel.lastIndexOf(" > ");
      if (cut < 0) break;
      parentSel = parentSel.slice(0, cut);
      const scope = query(parentSel);
      if (!scope) continue;
      let candidates;
      try {
        candidates = scope.querySelectorAll(CSS.escape(entry.tag));
      } catch {
        return null;
      }
      for (let i = 0; i < candidates.length && i < 500; i++) {
        const c = candidates[i];
        if (c.classList.contains("smudge-auto") || heldSurely(c, entry.id)) continue;
        if (fingerprint(c) === entry.fp) return c;
      }
      return null;
    }
    return null;
  }

  // Put every saved blur for this page on the right element. Cheap enough to
  // run on every batch of changes: a settled entry is a map lookup, an open
  // one a single querySelector. `thorough` (once the page goes quiet) also
  // re-checks weak matches' text and searches for elements that moved.
  //
  // Sure matches are placed before weak ones, so a weak guess can never sit
  // on the element another entry is surely on.
  function reconcile(thorough) {
    if (!page) return;
    const open = [];
    for (const entry of page.blurs) {
      const el = current(entry);
      if (el && !weak.has(entry.id)) continue;
      if (el && thorough && fingerprint(el) === entry.fp) {
        weak.delete(entry.id);
        continue;
      }
      open.push({ entry, el });
    }
    if (!open.length) return;

    const unsure = [];
    for (const item of open) {
      const { entry, el } = item;
      const at = query(entry.sel);
      let sure =
        at && at !== el && !heldSurely(at, entry.id) && fingerprint(at) === entry.fp ? at : null;
      if (!sure && thorough && (misses.get(entry.id) || 0) < MAX_SEARCHES) {
        sure = findByFingerprint(entry);
        if (!sure) misses.set(entry.id, (misses.get(entry.id) || 0) + 1);
      }
      if (sure && sure !== el) {
        if (el) release(entry.id);
        claim(sure, entry, false);
      } else if (sure) {
        weak.delete(entry.id);
      } else {
        item.at = at;
        unsure.push(item);
      }
    }

    // Nothing with the right text: blur whatever is in the saved spot. It may
    // still be filling in, or its text may have changed (a clock, a count).
    for (const { entry, el, at } of unsure) {
      if (el || !at || at.dataset.smudgeSaved) continue;
      if (at.classList.contains("smudge-auto")) continue;
      claim(at, entry, true);
    }
  }

  // -------------------------------------------------------------------------
  // Following the page
  // -------------------------------------------------------------------------

  function switchPage() {
    const key = currentPageKey();
    if (key === pageKey && page) return;
    pageKey = key;
    if (!pages.has(key)) pages.set(key, emptyPage());
    page = pages.get(key);
    revealSet = new Set(page.reveals);
    // Elements still on screen from the last page keep their blur: in a
    // single-page app a header blurred on one page is still the same header.
    live.clear();
    weak.clear();
    misses.clear();
  }

  function scheduleSettle() {
    if (settleTimer) return; // throttle, not debounce: busy pages still settle
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      if (active) reconcile(true);
    }, 200);
  }

  function onMutations(records) {
    if (!active) return;
    switchPage();
    const enabled = S.scannedFor();
    if (enabled) {
      for (const r of records) {
        if (r.type === "characterData") S.scanNode(r.target, enabled);
        else for (const n of r.addedNodes) S.scanNode(n, enabled);
      }
    }
    reconcile(false);
    scheduleSettle();
  }

  // Scripts on the page sometimes overwrite <html class>, which is where the
  // per-type reveals and the click-to-blur mode live.
  function onRootClass() {
    if (active) S.restoreRootClasses();
  }

  function fullPass() {
    if (!active) return;
    switchPage();
    const enabled = S.scannedFor();
    if (enabled && document.body) S.scanNode(document.body, enabled);
    reconcile(true);
  }

  function onNavigate() {
    if (!active) return;
    switchPage();
    reconcile(false);
    scheduleSettle();
  }

  function start(site) {
    if (active) return;
    active = true;
    S.injectStyles();
    for (const t of site.revealedTypes || []) S.setTypeBlurred(t, false);
    // Load this page's record before scanning: the scan asks it which
    // detected items were revealed here last time.
    switchPage();
    if (site.scanned && !S.scannedFor()) {
      S.scanAndBlur(site.enabled && site.enabled.length ? site.enabled : S.PII_TYPES);
    }

    observer = new MutationObserver(onMutations);
    observer.observe(document, { childList: true, subtree: true, characterData: true });
    rootObserver = new MutationObserver(onRootClass);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    addEventListener("popstate", onNavigate, true);
    addEventListener("hashchange", onNavigate, true);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fullPass, { once: true });
    }
    addEventListener("load", fullPass, { once: true });
    fullPass();
  }

  function stop() {
    if (!active) return;
    active = false;
    if (observer) observer.disconnect();
    if (rootObserver) rootObserver.disconnect();
    observer = rootObserver = null;
    clearTimeout(settleTimer);
    settleTimer = 0;
    removeEventListener("popstate", onNavigate, true);
    removeEventListener("hashchange", onNavigate, true);
    document.removeEventListener("DOMContentLoaded", fullPass);
    removeEventListener("load", fullPass);
    pages = new Map();
    page = null;
    pageKey = null;
    revealSet = new Set();
    live.clear();
    weak.clear();
    misses.clear();
  }

  // -------------------------------------------------------------------------
  // Hooks the redactor calls
  // -------------------------------------------------------------------------

  S.isRevealed = (type, text) => active && revealSet.has(hash(type + "|" + text));

  S.onUserToggle = (el, blurred) => {
    if (!active) return;
    switchPage();
    if (S.isDetected(el)) {
      const fp = revealFp(el);
      if (blurred) revealSet.delete(fp);
      else revealSet.add(fp);
      page.reveals = [...revealSet];
      savePage(pageKey);
      return;
    }
    if (blurred) {
      const sel = selectorFor(el);
      if (!sel) return; // nothing we could find again
      page.blurs.push(newEntry(el, sel));
      savePage(pageKey);
      return;
    }
    // Unblurred: forget it, on whichever page it was saved from.
    const id = el.dataset.smudgeSaved;
    delete el.dataset.smudgeSaved;
    if (!id) return;
    live.delete(id);
    weak.delete(id);
    for (const [key, p] of pages) {
      const i = p.blurs.findIndex((b) => b.id === id);
      if (i >= 0) {
        p.blurs.splice(i, 1);
        savePage(key);
        break;
      }
    }
  };

  // -------------------------------------------------------------------------
  // Entry points (index.js)
  // -------------------------------------------------------------------------

  // Read this site's record first, and everything else only if the site is
  // being kept — a page on any other site never sees what was stored.
  async function readSite() {
    try {
      const site = (await chrome.storage.session.get(SITE_KEY))[SITE_KEY];
      if (!site || !site.keep) return null;
      const area = chrome.storage.session;
      // getKeys (Chrome 130+) lets us fetch only this site's pages.
      if (area.getKeys) {
        const keys = (await area.getKeys()).filter((k) => k.startsWith(PAGE_PREFIX));
        loadPages(keys.length ? await area.get(keys) : {});
      } else {
        loadPages(await area.get(null));
      }
      return site;
    } catch {
      return null; // never switched on this session: storage stays closed to us
    }
  }

  // Every page load on a kept site: restore if this site is being kept.
  async function boot() {
    const site = await readSite();
    if (site && !active) start(site);
  }

  // The switch was just turned on: save what is already blurred here, then
  // keep following the page.
  async function enable() {
    if (active) return;
    const site = await readSite();
    if (!site || active) return;
    pageKey = null;
    switchPage();
    document.querySelectorAll(".smudge-manual-blur").forEach((el) => {
      if (el.dataset.smudgeSaved) return;
      const sel = selectorFor(el);
      if (!sel) return;
      page.blurs.push(newEntry(el, sel));
    });
    document
      .querySelectorAll(".smudge-auto:not(.smudge-blur), .smudge-field:not(.smudge-blur)")
      .forEach((el) => revealSet.add(revealFp(el)));
    page.reveals = [...revealSet];
    savePage(pageKey);
    start(site);
  }

  // Other tabs on the same site change what is remembered too; and when the
  // site is forgotten (Clear all, the switch, the browser) stop at once.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "session" || !active) return;
      if (SITE_KEY in changes && !changes[SITE_KEY].newValue) {
        stop();
        return;
      }
      if (SITE_KEY in changes && changes[SITE_KEY].newValue) {
        // A checkbox changed in the popup, possibly for another tab.
        const off = changes[SITE_KEY].newValue.revealedTypes || [];
        for (const t of S.PII_TYPES) S.setTypeBlurred(t, !off.includes(t));
      }
      for (const [k, { newValue }] of Object.entries(changes)) {
        if (!k.startsWith(PAGE_PREFIX)) continue;
        if (newValue && newValue.by === WRITER) continue; // our own write
        const key = k.slice(PAGE_PREFIX.length);
        const next = newValue || emptyPage();
        pages.set(key, next);
        if (key === pageKey) {
          page = next;
          revealSet = new Set(next.reveals);
        }
      }
    });
  } catch {
    // No storage API in this context.
  }

  S.keep = { boot, enable, stop, isActive: () => active };
})();
