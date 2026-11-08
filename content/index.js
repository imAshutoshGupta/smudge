// Smudge — content-script entry point. Injected last (after detectors.js,
// redactor.js and keep.js). Owns the injection guard and the message bridge
// to the popup.
//
// Everything runs locally in the page. No network, no exfil. The only thing
// kept is keep.js's in-memory list of what was blurred, and only on a site
// the person switched "Keep blurs" on for.

(() => {
  // Guard against double-injection: the popup may executeScript more than once,
  // but the message listener must only be registered a single time.
  if (window.__smudgeLoaded) return;
  window.__smudgeLoaded = true;

  const S = window.Smudge;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      switch (msg && msg.type) {
        case "PING":
          sendResponse({ ok: true });
          break;
        case "SCAN":
          sendResponse({ ok: true, counts: S.scanAndBlur(msg.enabled || []) });
          break;
        case "TOGGLE_TYPE":
          S.setTypeBlurred(msg.piiType, msg.blurred);
          sendResponse({ ok: true });
          break;
        case "SET_MANUAL":
          S.setManual(!!msg.on);
          sendResponse({ ok: true });
          break;
        case "CLEAR_ALL":
          S.keep.stop();
          S.clearAll();
          sendResponse({ ok: true });
          break;
        case "GET_STATE":
          sendResponse({ ok: true, keep: S.keep.isActive(), ...S.getState() });
          break;
        case "KEEP":
          // A frame from another site, embedded in this one, belongs to that
          // site's switch, not this one.
          if (msg.on && msg.origin && msg.origin !== location.origin) {
            sendResponse({ ok: true, skipped: true });
            break;
          }
          if (msg.on) {
            S.keep.enable().then(
              () => sendResponse({ ok: true }),
              (err) => sendResponse({ ok: false, error: String(err) })
            );
            return true;
          }
          S.keep.stop();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
    return true; // keep the channel open for the async sendResponse
  });

  // On a site with "Keep blurs" on, these scripts run at the start of every
  // page load; put back what was blurred here before. Elsewhere this finds
  // nothing to restore and does nothing.
  S.keep.boot();
})();
