// Smudge — the DOM layer. Injects scoped styles, scans + blurs detected PII,
// handles per-type reveal toggles, manual click-to-blur, and clearing.
//
// Depends on window.Smudge.findHits (from detectors.js, injected first).
//
// Runs once per frame — the popup injects into every frame it can reach, and
// each frame keeps its own manual-mode state and its own listeners.
//
// Vocabulary:
//   .smudge-blur        the thing that actually blurs (a CSS filter)
//   .smudge-auto        a span we wrapped around detected text
//   .smudge-field       an <input>/<textarea> blurred as a whole
//   .smudge-manual-blur a page element the user clicked to blur
//   html.smudge-manual  click-to-blur mode is on in this frame
//   [data-smudge-type]  which PII type an auto span or field holds

(() => {
  const S = (window.Smudge = window.Smudge || {});
  // Re-running would reset manualOn and orphan the listeners the live closure
  // already attached, leaving manual mode stuck on. Load once per frame.
  if (S.scanAndBlur) return;

  // ---------------------------------------------------------------------------
  // Styles (injected once, scoped to .smudge-* classes so we don't touch the page)
  // ---------------------------------------------------------------------------
  const STYLE_ID = "smudge-style";
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const revealSelectors = S.PII_TYPES.map(
      (t) => `html.smudge-reveal-${t} .smudge-blur[data-smudge-type="${t}"]`
    ).join(",\n      ");
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .smudge-blur {
        filter: blur(6px) !important;
        border-radius: 3px;
        transition: filter 0.08s ease;
        user-select: none;
      }
      /* Per-type reveal: when a type is toggled OFF in the popup, unblur it.
         Built from S.PII_TYPES rather than written out, so adding a detector
         doesn't need a matching line here. The type names are our own
         constants — [A-Z_]+ — so there's nothing to escape. */
      ${revealSelectors} {
        filter: none !important;
        user-select: auto;
      }
      /* Manual mode: highlight whatever the cursor is over so it's clear what
         a click will blur. Scoped to manual mode so a leftover .smudge-hover
         can never strand an outline on the page once the mode is off. */
      html.smudge-manual * { cursor: crosshair !important; }
      html.smudge-manual .smudge-hover {
        outline: 2px dashed #6c5ce7 !important;
        outline-offset: 1px !important;
        background: rgba(108, 92, 231, 0.08) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Scanning + blurring: text nodes
  // ---------------------------------------------------------------------------
  function shouldSkip(parent) {
    if (!parent) return true;
    const tag = parent.tagName;
    // TEXTAREA holds its live text in .value, so it's handled by scanFields.
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") {
      return true;
    }
    // .smudge-auto as well as .smudge-blur: a span the user manually revealed
    // has lost its blur, and re-scanning must not wrap it a second time (which
    // would nest spans and silently undo the reveal).
    if (parent.closest(".smudge-auto, .smudge-blur")) return true;
    if (parent.isContentEditable) return true;
    return false;
  }

  function wrapHit(text, hit) {
    const span = document.createElement("span");
    span.className = "smudge-blur smudge-auto";
    span.dataset.smudgeType = hit.type;
    span.title = "Redacted by Smudge";
    span.textContent = text;
    return span;
  }

  function processTextNode(node, enabled) {
    const text = node.nodeValue;
    if (!text || !text.trim()) return;
    const hits = S.findHits(text, enabled);
    if (!hits.length) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const h of hits) {
      if (h.start > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, h.start)));
      }
      frag.appendChild(wrapHit(text.slice(h.start, h.end), h));
      cursor = h.end;
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    node.parentNode.replaceChild(frag, node);
  }

  function scanText(enabled) {
    if (!document.body) return; // a frame caught mid-load
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    // Collect first, then mutate — mutating during traversal invalidates the walker.
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    for (const t of targets) processTextNode(t, enabled);
  }

  // ---------------------------------------------------------------------------
  // Scanning + blurring: form fields
  //
  // An input's text lives in .value, not in a text node, so the tree walker
  // never sees it. A field can't hold a wrapper span either, so we blur the
  // whole control.
  // ---------------------------------------------------------------------------
  const SKIP_INPUT_TYPES = new Set([
    "button", "checkbox", "color", "file", "hidden", "image",
    "password", "radio", "range", "reset", "submit",
  ]);

  function scanFields(enabled) {
    document.querySelectorAll("input, textarea").forEach((el) => {
      if (el.tagName === "INPUT" && SKIP_INPUT_TYPES.has((el.type || "").toLowerCase())) {
        return;
      }
      // Keyed on .smudge-field, not .smudge-blur, so a field the user manually
      // revealed stays revealed across a re-scan.
      if (el.classList.contains("smudge-field")) return;
      const value = el.value;
      if (!value || !value.trim()) return;
      const hits = S.findHits(value, enabled);
      if (!hits.length) return;
      // The field is blurred whole, so it carries a single type — the first
      // hit's. A field mixing types (rare) follows that one type's checkbox.
      el.classList.add("smudge-blur", "smudge-field");
      el.dataset.smudgeType = hits[0].type;
    });
  }

  // ---------------------------------------------------------------------------
  // Counting
  //
  // Count what is blurred *now* rather than what this pass added, so a second
  // scan over an already-redacted page reports the real total instead of zero.
  // Manual blurs carry no type and are deliberately left out.
  // ---------------------------------------------------------------------------
  function currentCounts() {
    const counts = {};
    for (const t of S.PII_TYPES) counts[t] = 0;
    document.querySelectorAll(".smudge-blur[data-smudge-type]").forEach((el) => {
      const type = el.dataset.smudgeType;
      if (type in counts) counts[type] += 1;
    });
    return counts;
  }

  function scanAndBlur(enabledArr) {
    injectStyles();
    const enabled = new Set(enabledArr);
    scanText(enabled);
    scanFields(enabled);
    return currentCounts();
  }

  // Toggle whether a given PII type stays blurred (popup checkboxes).
  function setTypeBlurred(type, blurred) {
    document.documentElement.classList.toggle("smudge-reveal-" + type, !blurred);
  }

  // ---------------------------------------------------------------------------
  // Manual click-to-blur mode
  // ---------------------------------------------------------------------------
  let manualOn = false;
  let hovered = null;

  // An auto span or field already answers to a type checkbox. Clicking it just
  // flips the blur — it keeps its class and data-smudge-type so the checkbox
  // keeps working and clearAll can still unwrap it.
  function isDetected(el) {
    return el.classList.contains("smudge-auto") || el.classList.contains("smudge-field");
  }

  function onHover(e) {
    if (!manualOn) return;
    const t = e.target;
    if (!t || t === document.body || t === document.documentElement) return;
    if (hovered && hovered !== t) hovered.classList.remove("smudge-hover");
    hovered = t;
    if (!t.classList.contains("smudge-blur")) t.classList.add("smudge-hover");
  }

  function onClick(e) {
    if (!manualOn) return;
    e.preventDefault();
    e.stopPropagation();
    const t = e.target;
    if (!t) return;
    t.classList.remove("smudge-hover");
    if (t.classList.contains("smudge-blur")) {
      t.classList.remove("smudge-blur");
      if (!isDetected(t)) t.classList.remove("smudge-manual-blur");
    } else {
      t.classList.add("smudge-blur");
      if (!isDetected(t)) t.classList.add("smudge-manual-blur");
    }
  }

  // Manual mode swallows page clicks, so leave an exit that doesn't depend on
  // reaching the popup.
  function onKeyDown(e) {
    if (manualOn && e.key === "Escape") setManual(false);
  }

  function setManual(on) {
    manualOn = on;
    injectStyles();
    document.documentElement.classList.toggle("smudge-manual", on);
    if (on) {
      document.addEventListener("mouseover", onHover, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeyDown, true);
    } else {
      document.removeEventListener("mouseover", onHover, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (hovered) hovered.classList.remove("smudge-hover");
      hovered = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Clear everything (unwrap auto spans, drop field + manual blurs, exit manual)
  // ---------------------------------------------------------------------------
  function clearAll() {
    setManual(false);
    // Unwrap auto-detected spans back to plain text.
    document.querySelectorAll("span.smudge-auto").forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent), span);
      parent.normalize();
    });
    // Un-blur form fields.
    document.querySelectorAll(".smudge-field").forEach((el) => {
      el.classList.remove("smudge-blur", "smudge-field");
      delete el.dataset.smudgeType;
    });
    // Remove manual element blurs.
    document.querySelectorAll(".smudge-manual-blur").forEach((el) => {
      el.classList.remove("smudge-blur", "smudge-manual-blur");
    });
    // Clear any per-type reveal flags.
    S.PII_TYPES.forEach((t) =>
      document.documentElement.classList.remove("smudge-reveal-" + t)
    );
  }

  S.scanAndBlur = scanAndBlur;
  S.setTypeBlurred = setTypeBlurred;
  S.setManual = setManual;
  S.clearAll = clearAll;
})();
