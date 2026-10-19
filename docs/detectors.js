// Smudge — PII detection (pure logic, no DOM).
//
// Exposes window.Smudge.findHits(text, enabledSet) and the list of types.
// This is the layer most likely to grow in v2 (e.g. a Gemini Nano backed
// name/address detector) — keep it free of DOM concerns.

(() => {
  const S = (window.Smudge = window.Smudge || {});
  if (S.findHits) return; // already loaded in this frame

  // Luhn check — reduces credit-card false positives (any 13–19 digit run that
  // doesn't pass the checksum is almost certainly not a card).
  function luhnValid(raw) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = parseInt(digits[i], 10);
      if (alt) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  const DETECTORS = [
    {
      type: "EMAIL",
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    },
    {
      // US-style SSN. Kept conservative to limit false positives.
      type: "SSN",
      regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    },
    {
      // Credit-card-shaped: 13–16 digits, optionally split by spaces/dashes.
      // Validated with Luhn before we accept it.
      type: "CREDIT_CARD",
      regex: /\b(?:\d[ -]?){12,18}\d\b/g,
      validate: luhnValid,
    },
    {
      // Phone numbers (US-ish + simple international). Loose by design — phone
      // formats vary wildly; we err toward catching rather than missing. The
      // (?<!\d) / (?!\d) guards stop it from matching a slice out of a longer
      // digit run (e.g. a 16-digit card number that failed the Luhn check).
      type: "PHONE",
      regex: /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,
    },
  ];

  // Find non-overlapping PII hits in a string, for the enabled types only.
  function findHits(text, enabled) {
    const hits = [];
    for (const det of DETECTORS) {
      if (!enabled.has(det.type)) continue;
      const re = new RegExp(det.regex.source, det.regex.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        const matched = m[0];
        if (det.validate && !det.validate(matched)) {
          if (m.index === re.lastIndex) re.lastIndex++;
          continue;
        }
        hits.push({
          start: m.index,
          end: m.index + matched.length,
          type: det.type,
          text: matched,
        });
        if (m.index === re.lastIndex) re.lastIndex++; // guard zero-length matches
      }
    }
    // Resolve overlaps: earliest start wins; ties broken by longest match.
    hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const result = [];
    let lastEnd = -1;
    for (const h of hits) {
      if (h.start >= lastEnd) {
        result.push(h);
        lastEnd = h.end;
      }
    }
    return result;
  }

  S.PII_TYPES = ["EMAIL", "PHONE", "CREDIT_CARD", "SSN"];
  S.findHits = findHits;
})();
