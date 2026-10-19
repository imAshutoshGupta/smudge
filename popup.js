// Smudge popup logic: inject the content script on demand, drive scanning,
// per-type toggles, manual mode, screenshot capture, and clearing.

const TYPE_LABELS = {
  EMAIL: "Emails",
  PHONE: "Phone numbers",
  CREDIT_CARD: "Credit-card numbers",
  SSN: "SSNs",
};

const els = {
  scan: document.getElementById("scan"),
  results: document.getElementById("results"),
  counts: document.getElementById("counts"),
  manual: document.getElementById("manual"),
  screenshot: document.getElementById("screenshot"),
  clear: document.getElementById("clear"),
  status: document.getElementById("status"),
};

let manualOn = false;

function setStatus(text, isError = false) {
  els.status.textContent = text || "";
  els.status.classList.toggle("error", isError);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Browser errors are written for developers. Translate the ones people can
// actually hit into something they can act on, and keep the original in the
// console for whoever is debugging.
const ERROR_MESSAGES = [
  // Order matters: a blocked chrome:// URL also says "cannot access", and the
  // browser-page wording is the more useful of the two.
  [
    /cannot be scripted|chrome:\/\/|edge:\/\/|showing error page/i,
    "Smudge only works on ordinary websites, not on the browser's own pages.",
  ],
  [
    /^file:\/\/|cannot access|host permission|manifest must request/i,
    "Smudge isn't allowed to read this page. If you opened a file from your " +
      "computer, go to chrome://extensions, click Details on Smudge, and turn " +
      "on “Allow access to file URLs”.",
  ],
  [
    /no tab with id|no window with id/i,
    "That tab isn't open any more. Open the page again and retry.",
  ],
  [
    /receiving end does not exist|could not establish connection|message port closed/i,
    "Smudge lost touch with the page. Reload the page, then try again.",
  ],
  [
    /frame with id|frame was removed/i,
    "The page changed while Smudge was working. Reload the page, then try again.",
  ],
];

function friendlyError(err) {
  const raw = err && err.message ? err.message : String(err);
  console.error("[Smudge]", err); // keep the real error for debugging
  for (const [pattern, message] of ERROR_MESSAGES) {
    if (pattern.test(raw)) return message;
  }
  return "Something went wrong. Reload the page, then try again.";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// chrome:// and the Web Store can't be scripted — bail out clearly.
function isRestricted(url) {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("https://chromewebstore.google.com")
  );
}

// Which frames we've injected, for this popup session. Injecting on every
// action would re-run the content scripts, resetting their manual-mode state
// and orphaning the listeners the live closure attached — manual mode could
// then never be switched off. The scripts guard against re-entry too; this
// keeps us from asking in the first place, and holds the frame ids.
let injected = null;

async function ensureInjected(tab) {
  if (injected && injected.tabId === tab.id) return injected;
  // allFrames: PII inside an iframe (embedded widgets, payment forms) is
  // invisible to a top-frame-only scan, and manual blur can't reach it either.
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ["content/detectors.js", "content/redactor.js", "content/index.js"],
  });
  injected = { tabId: tab.id, frameIds: results.map((r) => r.frameId) };
  return injected;
}

// Fan a message out to every injected frame. Each frame keeps its own state
// and answers for itself; frames that have navigated away are dropped.
async function send(target, message) {
  const replies = await Promise.all(
    target.frameIds.map(async (frameId) => {
      try {
        return await chrome.tabs.sendMessage(target.tabId, message, { frameId });
      } catch {
        return null;
      }
    })
  );
  return replies.filter((r) => r && r.ok);
}

// Run an action against the current tab, handling injection + restricted pages.
// Returns null (having set an error status) if the page can't be reached.
async function withTab(fn) {
  const tab = await getActiveTab();
  if (isRestricted(tab && tab.url)) {
    setStatus(
      "Smudge only works on ordinary websites, not on the browser's own pages.",
      true
    );
    return null;
  }
  try {
    const target = await ensureInjected(tab);
    return await fn(target, tab);
  } catch (err) {
    setStatus(friendlyError(err), true);
    return null;
  }
}

function mergeCounts(perFrame) {
  const merged = {};
  for (const counts of perFrame) {
    for (const [type, n] of Object.entries(counts || {})) {
      merged[type] = (merged[type] || 0) + n;
    }
  }
  return merged;
}

function renderCounts(counts) {
  els.counts.innerHTML = "";
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (total === 0) {
    const li = document.createElement("li");
    li.textContent =
      "Nothing found automatically. Use manual blur for names, addresses, " +
      "or anything else you want hidden.";
    els.counts.appendChild(li);
    els.results.classList.remove("hidden");
    return;
  }

  for (const type of Object.keys(TYPE_LABELS)) {
    const n = counts[type] || 0;
    if (n === 0) continue;

    const li = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.id = "type-" + type;
    checkbox.addEventListener("change", () => {
      withTab((target) =>
        send(target, { type: "TOGGLE_TYPE", piiType: type, blurred: checkbox.checked })
      );
    });

    const label = document.createElement("label");
    label.className = "label";
    label.htmlFor = checkbox.id;
    label.textContent = TYPE_LABELS[type];

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(n);

    li.append(checkbox, label, count);
    els.counts.appendChild(li);
  }

  els.results.classList.remove("hidden");
}

function setManualUI(on) {
  manualOn = on;
  els.manual.classList.toggle("active", on);
  els.manual.textContent = on ? "Disable click-to-blur" : "Enable click-to-blur";
}

// --- Wire up buttons --------------------------------------------------------

els.scan.addEventListener("click", async () => {
  setStatus("Scanning…");
  const replies = await withTab((target) =>
    send(target, { type: "SCAN", enabled: Object.keys(TYPE_LABELS) })
  );
  if (!replies) return; // withTab already reported why
  if (!replies.length) {
    setStatus("Smudge couldn't reach this page. Reload it, then try again.", true);
    return;
  }
  // Counts are of everything currently blurred, so re-scanning is stable.
  const counts = mergeCounts(replies.map((r) => r.counts));
  renderCounts(counts);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  setStatus(
    total
      ? `Blurred ${plural(total, "item")}.`
      : "Nothing found automatically — try manual blur."
  );
});

els.manual.addEventListener("click", async () => {
  const next = !manualOn;
  const replies = await withTab((target) =>
    send(target, { type: "SET_MANUAL", on: next })
  );
  if (!replies || !replies.length) return;
  setManualUI(next);
  setStatus(
    manualOn
      ? "Click elements on the page to blur them. Esc exits."
      : "Manual blur off."
  );
});

els.clear.addEventListener("click", async () => {
  const replies = await withTab((target) => send(target, { type: "CLEAR_ALL" }));
  if (!replies || !replies.length) return;
  setManualUI(false);
  els.results.classList.add("hidden");
  els.counts.innerHTML = "";
  setStatus("Cleared all blurs.");
});

els.screenshot.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (isRestricted(tab && tab.url)) {
    setStatus(
      "Smudge can only take a picture of an ordinary website, not the " +
        "browser's own pages.",
      true
    );
    return;
  }
  setStatus("Capturing…");
  try {
    // captureVisibleTab is allowed by the activeTab permission.
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "smudge-screenshot.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus("Saved to your Downloads — the part of the page you can see.");
  } catch (err) {
    setStatus(friendlyError(err), true);
  }
});
