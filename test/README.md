# Test fixture

Manual checks for the content scripts. Serve over http:// — `file://` iframes
and script injection need the extension's "Allow access to file URLs" setting,
which just adds a variable.

```sh
cd test && python3 -m http.server 8000
```

Then open http://localhost:8000/fixture.html and reload the extension at
`chrome://extensions` first if you've edited the content scripts.

## What to check

1. **Scan & blur** — text, form fields, and the iframe all blur. The
   Luhn-invalid card and the password field stay clear.
2. **The ID section** — Aadhaar, PAN, UPI, licence, GSTIN and IFSC all blur,
   spaced or not. Both "must stay clear" lines stay completely clear: the
   decimal, the range, the grouped order number and the log line are the
   shapes these patterns are easiest to get wrong, so check them properly.
   On the line after them, nothing is flagged as an ID — a phone blur over
   part of those digits is the existing loose phone pattern doing its usual
   thing, and is fine.
3. **Scan again** — counts stay the same instead of dropping to zero.
4. **Untick a type** — only that type reveals, in the iframe too.
5. **Click-to-blur on, then off** (button or Esc) — the link works again and
   no dashed outlines trail the cursor.
6. **Click a blurred email in manual mode** — it reveals; its type checkbox
   still controls it afterwards.
7. **Clear all blurs** — page returns to its original state.

# Keep blurs across pages

The pages in `keep/` need a small Node server rather than `http.server`: the
single-page app's routes have to survive a reload, and one page is sent in two
parts on purpose.

```sh
node test/keep/server.cjs        # http://localhost:8000
```

Reload the extension at `chrome://extensions` first if you've edited it.

## Automated

`keep/keep.test.cjs` drives a real Chromium with the extension loaded, through
the real popup. It needs Playwright, installed anywhere outside this folder
so the repo stays dependency-free:

```sh
cd /some/scratch/dir && npm i playwright-core && npx playwright-core install chromium
cd -  # back to the repo
PLAYWRIGHT=/some/scratch/dir/node_modules/playwright-core node --test test/keep/keep.test.cjs
```

`HEADED=1` shows the browser; `CHROME_PATH=…` picks a different Chromium.
Branded Google Chrome won't load an unpacked extension from the command line;
Playwright's Chromium (Chrome for Testing) will.

## By hand

Open http://localhost:8000/keep/one.html.

1. **Off, nothing changes** — scan, click-to-blur the note, go to page two and
   back. The blurs are gone, as before.
2. **Switch it on** — scan, click-to-blur the note and the name card, then
   switch on **Keep blurs as I move around this site**. Chrome asks for access
   to `localhost`; allow it.
3. **Page two** — the email and phone blur by themselves as the page loads.
   The note on page two stays clear: page one's blurs belong to page one.
4. **Back to page one** — by the link and by the Back button. The emails, the
   field, the note, the name card and the "Last seen" line are all blurred.
   (Its time changes on every load; it's blurred because it's in the same
   spot.)
5. **Change your mind** — on page one, click-to-blur the address and click the
   note to unblur it. Reload: the address is blurred, the note isn't.
6. **Reveals and types stick** — click a blurred email to reveal it; on page
   two untick *Phone numbers*. Go back and forth: both stay the way you left
   them, and reopening the popup shows the checkbox unticked.
7. **The layout moves** — in the console on page one, run
   `localStorage.setItem("smudge-test-banner", 1)` and reload. A banner
   appears above the note; the note is still blurred and the banner isn't.
   Run `localStorage.removeItem("smudge-test-banner")` afterwards.
8. **Slow page** — open http://localhost:8000/keep/slow.html, wait for
   "Loaded.", click-to-blur the "Private" line, then reload. While the page is
   still loading (1.5 s), the email and the private line are already blurred.
9. **Single-page app** — http://localhost:8000/spa/a. Click-to-blur the
   account manager line. Go to Route B and back, use Back and Forward, and
   reload: the line is blurred each time on Route A. Hash routes C and D are
   pages of their own.
10. **Another site** — http://127.0.0.1:8000/keep/one.html is a different site
    and is never touched.
11. **Switch it off** — blurs on screen stay; reload and nothing comes back.
12. **Clear all blurs** — with it on, Clear all puts the page back, turns the
    switch off and forgets the site. `localhost` disappears from Smudge's site
    access on its Details page in `chrome://extensions`.
13. **Close the browser** — with it on, quit and reopen Chrome. The switch is
    off and the site access has been removed.
