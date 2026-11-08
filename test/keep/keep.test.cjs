// End-to-end tests for "Keep blurs as I move around this site".
//
// Drives a real Chromium with the extension loaded, through the real popup,
// against the pages in this folder. See test/README.md for how to run it.
//
// Two things differ from a person using it, both for automation's sake:
//   - The extension is loaded from a temporary copy whose manifest already
//     grants http://localhost and http://127.0.0.1, so Chrome's permission
//     prompt (which a script can't click) answers "yes" by itself. Everything
//     after the prompt is the shipping code.
//   - The popup is opened as a tab and told which tab is "active", since a
//     script can't click the toolbar icon.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { chromium } = require(process.env.PLAYWRIGHT || "playwright-core");
const { start } = require("./server.cjs");

const REPO = path.join(__dirname, "..", "..");
// SMUDGE_EXT_DIR=<unzipped smudge.zip> tests the packaged download instead.
const SRC = process.env.SMUDGE_EXT_DIR || REPO;
const PORT = Number(process.env.PORT) || 8765;
const BASE = `http://localhost:${PORT}`;
const OTHER = `http://127.0.0.1:${PORT}`; // a different site, never kept

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const dirs = fs.existsSync(cache)
    ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
    : [];
  for (const d of dirs) {
    for (const arch of ["chrome-mac-arm64", "chrome-mac", "chrome-mac-x64"]) {
      const p = path.join(cache, d, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined; // let Playwright look for its own
}

function stageExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smudge-ext-"));
  for (const f of ["manifest.json", "popup.html", "popup.css", "popup.js", "theme.js", "site-access.js", "background.js"]) {
    fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  }
  fs.cpSync(path.join(SRC, "content"), path.join(dir, "content"), { recursive: true });
  fs.cpSync(path.join(SRC, "icons"), path.join(dir, "icons"), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  manifest.host_permissions = ["http://localhost/*", "http://127.0.0.1/*"];
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

let server, context, worker, extId, extDir, userDir;

before(async () => {
  server = await start(PORT);
  extDir = stageExtension();
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), "smudge-profile-"));
  context = await chromium.launchPersistentContext(userDir, {
    executablePath: findChrome(),
    headless: process.env.HEADED ? false : true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  extId = new URL(worker.url()).host;
});

after(async () => {
  if (context) await context.close();
  if (server) server.close();
  for (const d of [extDir, userDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
});

// --- helpers ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Long enough for keep.js's "page went quiet" pass (200 ms) to have run.
const settle = () => sleep(450);

async function freshPage(url) {
  for (const p of context.pages()) await p.close();
  const page = await context.newPage();
  if (url) await page.goto(url);
  return page;
}

async function resetExtension() {
  await worker.evaluate(async () => {
    await chrome.storage.session.clear();
    await chrome.scripting.unregisterContentScripts();
  });
}

// Open the popup "for" a tab, do something in it, close it.
async function withPopup(target, fn) {
  const url = target.url();
  const popup = await context.newPage();
  await popup.addInitScript((u) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (info) => {
      if (info && info.active) {
        const tabs = await query({});
        return tabs.filter((t) => t.url === u).slice(0, 1);
      }
      return query(info);
    };
  }, url);
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector("body[data-ready]");
  try {
    return await fn(popup);
  } finally {
    await popup.close();
    await target.bringToFront();
  }
}

async function clickAndWaitStatus(popup, selector, pattern) {
  await popup.click(selector);
  await popup.waitForFunction(
    (re) => new RegExp(re, "i").test(document.getElementById("status").textContent),
    pattern.source
  );
  return popup.textContent("#status");
}

const scan = (page) => withPopup(page, (p) => clickAndWaitStatus(p, "#scan", /blurred|nothing found/));
const keepOn = (page) => withPopup(page, (p) => clickAndWaitStatus(p, "#keep", /will now stay/));
const keepOff = (page) => withPopup(page, (p) => clickAndWaitStatus(p, "#keep", /stopped keeping/));
const clearAll = (page) => withPopup(page, (p) => clickAndWaitStatus(p, "#clear", /cleared all/));

// Click-to-blur: switch it on in the popup, click each target on the page,
// then Esc out of it on the page.
async function clickToBlur(page, selectors) {
  await withPopup(page, (p) => clickAndWaitStatus(p, "#manual", /click elements/));
  for (const s of selectors) await page.click(s);
  await page.keyboard.press("Escape");
}

// Is it actually blurred on screen — the class *and* a computed blur filter.
function blurState(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing";
    const f = getComputedStyle(el).filter;
    return f && f.includes("blur") ? "blurred" : "clear";
  }, selector);
}

async function expectBlur(page, selector, want, why) {
  assert.equal(await blurState(page, selector), want, `${selector} should be ${want}${why ? " — " + why : ""}`);
}

// Every test that needs a kept site starts its own, so one failure can't
// leave state behind for the next.
async function keptPage(url, { waitFor } = {}) {
  await resetExtension();
  const page = await freshPage(url);
  if (waitFor) await page.waitForSelector(waitFor);
  await scan(page);
  await keepOn(page);
  return page;
}

const sessionStorage = () => worker.evaluate(() => chrome.storage.session.get(null));
const registered = () => worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());

// --- tests --------------------------------------------------------------------

test("existing fixture: scan still blurs, and a second scan reports the same counts", async () => {
  await resetExtension();
  const page = await freshPage(`${BASE}/fixture.html`);
  const first = await scan(page);
  const second = await scan(page);
  assert.match(first, /Blurred \d+ items/);
  assert.equal(first, second);
  await expectBlur(page, "input[type=password]", "clear", "passwords are never touched");
});

test("without Keep, nothing is stored and blurs go when you leave the page (unchanged)", async () => {
  await resetExtension();
  const page = await freshPage(`${BASE}/keep/one.html`);
  await scan(page);
  await clickToBlur(page, [".note"]);
  await expectBlur(page, ".note", "blurred");
  await page.click("#to-two");
  await page.waitForSelector(".phone");
  await page.click("#to-one");
  await page.waitForSelector(".note");
  await settle();
  await expectBlur(page, ".note", "clear");
  assert.equal(await page.locator(".smudge-auto").count(), 0);
  assert.deepEqual(await sessionStorage(), {});
  assert.deepEqual(await registered(), []);
});

test("Keep on: page one's blurs come back after visiting page two (links and Back)", async () => {
  await resetExtension();
  const page = await freshPage(`${BASE}/keep/one.html`);
  await scan(page);
  await clickToBlur(page, [".note", ".name", ".clock"]);
  await keepOn(page);

  const stored = await sessionStorage();
  assert.ok(stored[`site|${BASE}`]?.keep, "site record written");
  assert.equal(stored[`site|${BASE}`].scanned, true, "the earlier scan carried over");
  const pageEntry = stored[`page|${BASE}|/keep/one.html`];
  assert.equal(pageEntry.blurs.length, 3);
  for (const b of pageEntry.blurs) {
    assert.doesNotMatch(JSON.stringify(b), /Ada|Private|Last seen/, "no page text is stored");
  }
  assert.equal((await registered()).length, 1);

  await page.click("#to-two");
  await page.waitForSelector(".phone");
  await settle();
  await expectBlur(page, ".phone .smudge-auto", "blurred", "page two is scanned as it loads");
  await expectBlur(page, ".email .smudge-auto", "blurred");
  await expectBlur(page, ".note", "clear", "page one's blurs belong to page one");

  await page.click("#to-one");
  await page.waitForSelector(".note");
  await settle();
  await expectBlur(page, ".email .smudge-auto", "blurred");
  await expectBlur(page, ".field", "blurred");
  await expectBlur(page, ".note", "blurred", "the click-blur came back");
  await expectBlur(page, ".name", "blurred");
  await expectBlur(page, ".clock", "blurred", "its text changed, but it's in the same spot");
  await expectBlur(page, ".addr", "clear", "nothing extra blurred");

  await page.goto(`${BASE}/keep/two.html`);
  await page.goBack();
  await page.waitForSelector(".note");
  await settle();
  await expectBlur(page, ".note", "blurred", "after Back");
  await expectBlur(page, ".name", "blurred", "after Back");
});

test("Keep on: a new click-blur is remembered, and clicking it again forgets it", async () => {
  const page = await keptPage(`${BASE}/keep/one.html`);
  await clickToBlur(page, [".name", ".note"]);
  await page.reload();
  await settle();
  await expectBlur(page, ".note", "blurred");
  await clickToBlur(page, [".addr", ".note"]); // blur the address, unblur the note
  await expectBlur(page, ".addr", "blurred");
  await expectBlur(page, ".note", "clear");
  await page.reload();
  await settle();
  await expectBlur(page, ".addr", "blurred", "remembered");
  await expectBlur(page, ".note", "clear", "forgotten");
  await expectBlur(page, ".name", "blurred", "untouched blurs stay");
});

test("Keep on: revealing one detected item and unticking a type both stick", async () => {
  const page = await keptPage(`${BASE}/keep/one.html`);
  await clickToBlur(page, [".backup .smudge-auto"]);
  await expectBlur(page, ".backup .smudge-auto", "clear");

  await page.click("#to-two");
  await page.waitForSelector(".phone");
  await settle();
  await withPopup(page, async (p) => {
    assert.equal(await p.isChecked("#keep"), true, "popup shows the site as kept");
    assert.equal(await p.isVisible("#results"), true, "popup shows what was found here");
    await p.uncheck("#type-PHONE");
    await sleep(150);
  });
  await expectBlur(page, ".phone .smudge-auto", "clear");

  // A page script wiping <html class> must not bring the phone blur back.
  await page.evaluate(() => {
    document.documentElement.className = "page-owned";
  });
  await sleep(50);
  await expectBlur(page, ".phone .smudge-auto", "clear", "after the page rewrote <html class>");

  await page.click("#to-one");
  await page.waitForSelector(".backup");
  await settle();
  await expectBlur(page, ".backup .smudge-auto", "clear", "the revealed item stays revealed");
  await expectBlur(page, ".email .smudge-auto", "blurred", "other items stay blurred");

  await page.click("#to-two");
  await page.waitForSelector(".phone");
  await settle();
  await expectBlur(page, ".phone .smudge-auto", "clear", "the unticked type stays unticked");
  await expectBlur(page, ".email .smudge-auto", "blurred");
  await withPopup(page, async (p) => {
    assert.equal(await p.isChecked("#type-PHONE"), false, "checkbox drawn unticked on reopen");
    await p.check("#type-PHONE");
    await sleep(150);
  });
  await expectBlur(page, ".phone .smudge-auto", "blurred");
});

test("Keep on: when the layout moves, the blur follows the element, not the old spot", async () => {
  const page = await keptPage(`${BASE}/keep/one.html`);
  await clickToBlur(page, [".note"]);
  await page.evaluate(() => localStorage.setItem("smudge-test-banner", "1"));
  try {
    await page.reload();
    await page.waitForSelector(".banner");
    await settle();
    await expectBlur(page, ".note", "blurred", "found again by its text");
    await expectBlur(page, ".banner", "clear", "the banner now in its old spot is left alone");
  } finally {
    await page.evaluate(() => localStorage.removeItem("smudge-test-banner"));
  }
});

test("Keep on: blurs go on while a slow page is still loading, top to bottom", async () => {
  const page = await keptPage(`${BASE}/keep/slow.html`, { waitFor: ".done" });
  await clickToBlur(page, [".slow-note"]);

  // Load it again and look while only the first part has arrived.
  await page.goto(`${BASE}/keep/slow.html`, { waitUntil: "commit" });
  await page.waitForSelector(".slow-note", { state: "attached" });
  const midway = await page.evaluate(() => ({
    loading: document.readyState === "loading",
    lateArrived: !!document.querySelector(".late"),
    early: getComputedStyle(document.querySelector(".early .smudge-auto") || document.body).filter,
    note: getComputedStyle(document.querySelector(".slow-note")).filter,
  }));
  assert.equal(midway.loading, true, "page still loading");
  assert.equal(midway.lateArrived, false, "second part not here yet");
  assert.match(midway.early, /blur/, "detected item in the first part already blurred");
  assert.match(midway.note, /blur/, "click-blur in the first part already blurred");

  await page.waitForSelector(".done");
  await settle();
  await expectBlur(page, ".late .smudge-auto", "blurred", "the second part is scanned on arrival");
});

test("Keep on: a different site is not touched", async () => {
  const page = await freshPage(`${OTHER}/keep/one.html`);
  await settle();
  await expectBlur(page, ".note", "clear");
  assert.equal(await page.locator(".smudge-auto").count(), 0);
});

test("Keep on in a single-page app: pushState routes, Back/Forward, hash routes, reload", async () => {
  const page = await keptPage(`${BASE}/spa/a`, { waitFor: ".secret" });
  await clickToBlur(page, [".secret"]);
  await page.click("a[href='/spa/b']");
  await page.waitForSelector(".other");
  await settle();
  await expectBlur(page, ".phone .smudge-auto", "blurred", "new route scanned as it renders");
  await expectBlur(page, ".other", "clear");

  await page.click("a[href='/spa/a']");
  await page.waitForSelector(".secret");
  await settle();
  await expectBlur(page, ".secret", "blurred", "back on route A");
  await expectBlur(page, ".contact .smudge-auto", "blurred");

  await page.goBack();
  await page.waitForSelector(".other");
  await page.goForward();
  await page.waitForSelector(".secret");
  await settle();
  await expectBlur(page, ".secret", "blurred", "after Back then Forward");

  await page.click("a[href='#/c']");
  await page.waitForSelector(".contact >> text=recover");
  await settle();
  await expectBlur(page, ".secret", "clear", "hash route C is its own page");
  await expectBlur(page, ".contact .smudge-auto", "blurred");
  await clickToBlur(page, [".secret"]);
  await page.click("a[href='#/d']");
  await page.waitForSelector(".other");
  await page.click("a[href='#/c']");
  await page.waitForSelector(".contact >> text=recover");
  await settle();
  await expectBlur(page, ".secret", "blurred", "back on hash route C");

  await page.goto(`${BASE}/spa/a`);
  await page.waitForSelector(".secret");
  await settle();
  await expectBlur(page, ".secret", "blurred", "after a full reload of the app");
});

test("switching Keep off forgets the site but leaves this page's blurs", async () => {
  const page = await keptPage(`${BASE}/keep/one.html`);
  await clickToBlur(page, [".name"]);
  await page.reload();
  await settle();
  await expectBlur(page, ".name", "blurred");
  await keepOff(page);
  await expectBlur(page, ".name", "blurred", "on-screen blurs stay until Clear all");
  assert.deepEqual(await sessionStorage(), {});
  assert.deepEqual(await registered(), []);
  await page.reload();
  await settle();
  await expectBlur(page, ".name", "clear", "nothing restored once off");
  assert.equal(await page.locator(".smudge-auto").count(), 0);
});

test("Clear all ends Keep: page clean, site forgotten, switch off", async () => {
  await resetExtension();
  const page = await freshPage(`${BASE}/keep/one.html`);
  await scan(page);
  await clickToBlur(page, [".name"]);
  await keepOn(page);
  await page.click("#to-two");
  await page.waitForSelector(".phone");
  await page.click("#to-one");
  await page.waitForSelector(".name");
  await settle();
  await expectBlur(page, ".name", "blurred");

  await clearAll(page);
  await expectBlur(page, ".name", "clear");
  assert.equal(await page.locator(".smudge-auto").count(), 0);
  assert.deepEqual(await sessionStorage(), {});
  assert.deepEqual(await registered(), []);
  await withPopup(page, async (p) => {
    assert.equal(await p.isChecked("#keep"), false);
  });
  await page.click("#to-two");
  await page.waitForSelector(".phone");
  await settle();
  assert.equal(await page.locator(".smudge-auto").count(), 0, "page two isn't scanned any more");
});

test("the switch is disabled where Keep can't work", async () => {
  const page = await freshPage("about:blank");
  await withPopup(page, async (p) => {
    assert.equal(await p.isDisabled("#keep"), true);
  });
});
