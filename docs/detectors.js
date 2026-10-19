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

  // ---------------------------------------------------------------------------
  // Government and financial ID numbers
  //
  // Most of these are plain digit runs that shape alone would over-match
  // wildly. So every one that carries a checksum or a fixed vocabulary is
  // checked against it before we blur — the same bargain the card detector
  // already makes with Luhn. Anything without something to check against is
  // left to click-to-blur rather than guessed at.
  // ---------------------------------------------------------------------------

  // Verhoeff checksum — the last digit of an Aadhaar number. Catches every
  // single-digit error and every adjacent transposition, and throws out
  // roughly nine in ten arbitrary 12-digit runs.
  const VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];

  function aadhaarValid(raw) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 12) return false;
    let c = 0;
    for (let i = 0; i < digits.length; i++) {
      const d = digits.charCodeAt(digits.length - 1 - i) - 48;
      c = VERHOEFF_D[c][VERHOEFF_P[i % 8][d]];
    }
    return c === 0;
  }

  // The 4th letter of a PAN is the holder type — a fixed vocabulary, so it
  // rejects about half of the tokens that merely have the right shape.
  // P individual · C company · H HUF · F firm/LLP · A association of persons ·
  // T trust · B body of individuals · L local authority · J artificial
  // juridical person · G government, plus E/K/V, which do occur in the wild.
  const PAN_HOLDER_TYPES = new Set("ABCEFGHJKLPTV".split(""));

  function panValid(raw) {
    return PAN_HOLDER_TYPES.has(raw[3]);
  }

  // GSTIN check character: a weighted sum over the first 14 characters in
  // base 36, alternating weights of 1 and 2.
  const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function gstinValid(raw) {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const v = BASE36.indexOf(raw[i]);
      if (v < 0) return false;
      const p = v * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(p / 36) + (p % 36);
    }
    return BASE36[(36 - (sum % 36)) % 36] === raw[14];
  }

  // A driving licence has no checksum, so the state code carries the filtering.
  const LICENCE_STATE_CODES = new Set(
    ("AN AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN " +
      "MP MZ NL OD OR PB PY RJ SK TN TR TS UK UP WB").split(" ")
  );

  function drivingLicenseValid(raw) {
    return LICENCE_STATE_CODES.has(raw.slice(0, 2));
  }

  // A UPI address looks like an email, but its handle never contains a dot —
  // which is also why the email detector never claims one. "word@word" is far
  // too common in ordinary text (node@18, react@18.3.1, a Slack handle) to
  // blur on shape, so we match the handle against the real payment ones.
  // Extend this list as banks and apps add their own.
  const UPI_HANDLES = new Set(
    ("abfspay airtel apl axisb axisbank axl barodampay barodapay cboi cnrb " +
      "dbs dlb equitas fbl federal finobank freecharge goaxb hdfcbank hsbc " +
      "ibl icici idbi idfcbank ikwik indus internet jio jkb jupiteraxis kbl " +
      "kmb kmbl kotak kvb mahb myicici naviaxis okaxis okbizaxis okhdfcbank " +
      "okicici oksbi paytm pingpay pnb pockets postbank purz rbl sbi sib " +
      "slice superyes tapicici timecosmos uboi ubi uco unionbank upi utbi " +
      "waaxis wahdfcbank waicici wasbi ybl yapl yesbank yesbankltd yesg " +
      "zoicici").split(" ")
  );

  function upiValid(raw) {
    return UPI_HANDLES.has(raw.slice(raw.lastIndexOf("@") + 1).toLowerCase());
  }

  // Order matters where two patterns can claim the same span: findHits breaks a
  // tie by position in this list. The ID numbers sit ahead of the phone
  // patterns so that, say, an unspaced Aadhaar isn't read as a phone number
  // with a country code.
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
      // Aadhaar — 12 digits, printed in 4-4-4 groups as often as not, and
      // never starting with 0 or 1. Verhoeff-checked.
      type: "AADHAAR",
      regex: /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g,
      validate: aadhaarValid,
    },
    {
      // PAN — five letters, four digits, a letter.
      type: "PAN",
      regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
      validate: panValid,
    },
    {
      // GSTIN — state code, then the business's PAN, an entity number, a Z,
      // and a check character. It contains a PAN but starts earlier in the
      // string, so the overlap rule hands it the whole span.
      type: "GSTIN",
      regex: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g,
      validate: gstinValid,
    },
    {
      // IFSC — bank code, a fixed 0, branch code. Distinctive enough on shape.
      type: "IFSC",
      regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    },
    {
      // Driving licence — state, RTO, year of issue, serial; written with or
      // without separators. The state code and a plausible year do the work.
      type: "DRIVING_LICENSE",
      regex: /\b[A-Z]{2}[ -]?\d{2}[ -]?(?:19|20)\d{2}[ -]?\d{7}\b/g,
      validate: drivingLicenseValid,
    },
    {
      // UPI payment address.
      type: "UPI",
      regex: /\b[A-Za-z0-9][A-Za-z0-9._-]{1,63}@[A-Za-z]{2,24}\b/g,
      validate: upiValid,
    },
    {
      // Phone numbers (US-ish + simple international). Loose by design — phone
      // formats vary wildly; we err toward catching rather than missing. The
      // (?<!\d) / (?!\d) guards stop it from matching a slice out of a longer
      // digit run (e.g. a 16-digit card number that failed the Luhn check).
      type: "PHONE",
      regex: /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,
    },
    {
      // Ten-digit mobile numbers starting 6–9, usually written with a +91
      // country code and split 5-5. The pattern above is built around 3-3-4
      // grouping and misses those, so they get one of their own under the
      // same type.
      type: "PHONE",
      regex: /(?<!\d)(?:(?:\+?91|0)[ .-]?)?[6-9]\d{4}[ .-]?\d{5}(?!\d)/g,
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

  S.PII_TYPES = [
    "EMAIL",
    "PHONE",
    "CREDIT_CARD",
    "SSN",
    "AADHAAR",
    "PAN",
    "UPI",
    "DRIVING_LICENSE",
    "GSTIN",
    "IFSC",
  ];
  S.findHits = findHits;
})();
