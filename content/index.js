// Smudge — content-script entry point. Injected last (after detectors.js and
// redactor.js). Owns the injection guard and the message bridge to the popup.
//
// Everything runs locally in the page. No network, no storage, no exfil.

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
          S.clearAll();
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
})();
