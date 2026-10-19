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
   spaced or not. The "must stay clear" line stays clear. On the line below
   it, nothing is flagged as an ID — a phone blur over part of those digits
   is the existing loose phone pattern doing its usual thing, and is fine.
3. **Scan again** — counts stay the same instead of dropping to zero.
4. **Untick a type** — only that type reveals, in the iframe too.
5. **Click-to-blur on, then off** (button or Esc) — the link works again and
   no dashed outlines trail the cursor.
6. **Click a blurred email in manual mode** — it reveals; its type checkbox
   still controls it afterwards.
7. **Clear all blurs** — page returns to its original state.
