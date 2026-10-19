# Smudge

A Chrome extension that finds personal details on a web page — emails, phone
numbers, card numbers, Social Security numbers — and blurs them before you take
a screenshot or share your screen.

Everything runs locally. No network requests, no storage, no account.

**[Download and try it →](https://imashutoshgupta.github.io/smudge/)** — the
site has a live demo you can type into, plus install steps.

![Smudge](icons/icon-128.png)

## Install

Smudge isn't on the Chrome Web Store yet, so install it from source. It takes
about a minute.

1. Download this repository — **Code → Download ZIP** — and unzip it. Or clone
   it: `git clone https://github.com/imAshutoshGupta/smudge.git`
2. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge)
3. Turn on **Developer mode**, top right
4. Click **Load unpacked** and select the unzipped folder
5. Click the puzzle-piece icon in the toolbar and pin Smudge

Chrome will show a "Developer mode extensions" notice on startup. That's
expected for any extension installed this way.

## Use

1. Open the page you want to share
2. Click the Smudge icon → **Scan & blur this page**
3. Anything it missed, blur yourself: **Enable click-to-blur**, then click any
   part of the page. Click a blurred thing to bring it back. Esc exits.
4. **Save screenshot** writes a PNG of the visible area to your Downloads, with
   the blurs baked in. Or leave the blurs up while you share your screen.
5. **Clear all blurs** puts the page back exactly as it was

Untick a category in the popup to reveal just that kind of item again.

## Privacy

No data is collected, stored or transmitted. See [PRIVACY.md](PRIVACY.md).

## License

Copyright © 2026 Ashutosh Gupta. All rights reserved.

The source is public so that anyone using the extension can read it and check
that the privacy claims above are true. You're welcome to read it and to run
the extension yourself — but copying, modifying or redistributing it needs
written permission. See [LICENSE](LICENSE).
