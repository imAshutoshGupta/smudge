# Privacy Policy for Smudge

_Last updated: 8 November 2026_

## Summary

Smudge does not collect, transmit, or sell any data, and saves nothing to
disk. Everything the extension does happens inside your browser, on your own
computer.

## What Smudge does

When you click "Scan & blur this page", Smudge reads the text of the page you
are currently viewing in order to find patterns that look like personal
details — email addresses, phone numbers, payment card numbers, payment
addresses, and government and financial ID numbers such as Social Security
numbers, Aadhaar, PAN, driving licence numbers, GSTINs and IFSC codes — and
applies a visual blur to them.

That reading happens entirely in your browser's memory. The page text is never
written to disk, never sent over the network, and never shared with the
developer or anyone else.

If you switch on **Keep blurs as I move around this site** in the popup,
Smudge also puts your blurs back when you return to a page of that site. How
that works, and what it remembers, is described under Storage below.

## Data collection

Smudge collects **no** data of any kind. Specifically, it does not collect:

- personally identifiable information
- health, financial or authentication information
- personal communications
- location data
- browsing history or web activity
- user activity, analytics or crash telemetry

## Network activity

Smudge makes **no** network requests. It has no server, no analytics provider
and no third-party services. The extension package contains no remotely hosted
code; all of its code ships inside the extension and can be inspected.

## Storage

Smudge saves nothing to disk and sends nothing anywhere.

When you switch on "Keep blurs" for a site, Smudge remembers which parts of the
page you blurred, in your browser's memory on your computer, so the blurs stay
as you move between pages. It never keeps the text you blurred, only where it
was. Everything is forgotten when you press Clear all or close the browser.

In more detail: for each page of that site, Smudge keeps the position of each
thing you clicked to blur and a short fingerprint (a hash) of its text, used
only to check that the thing in that position is still the one you blurred. It
also keeps a note that you scanned the site, and which kinds of detail you
unticked. This is held in `chrome.storage.session`, which Chrome keeps in
memory and never writes to disk. Switching "Keep blurs" off forgets the site
straight away.

Without "Keep blurs", blurs exist only in the current page and disappear when
you reload or leave it.

The one other thing Smudge remembers is the popup theme you picked. It's
saved in the extension's own `localStorage` on your computer, holds only the
theme's name, and is never sent anywhere.

## Permissions

Smudge requests three permissions. It has no host permissions unless you switch
on "Keep blurs" for a site; then only that site, and you can remove it any
time.

- **activeTab** — temporary access to the single tab you are currently viewing,
  granted only at the moment you click the Smudge toolbar button, and revoked
  when you navigate away. Smudge cannot read any page you have not explicitly
  pointed it at.
- **scripting** — to inject the detection and blurring code into that page when
  you ask it to. None of Smudge's code runs on any page until you click the
  button, or on a site where you've switched on "Keep blurs".
- **storage** — used only for the in-memory list described under Storage, on
  sites where you've switched on "Keep blurs". Nothing is written to disk.

**Access to one site, only if you ask for it.** Switching on "Keep blurs" asks
Chrome for access to the site you're on, and Chrome shows its own prompt for
it. With that access, Smudge's code runs on that site's pages as they load, so
it can put your blurs back, and on no other site. Smudge gives the access back
when you switch "Keep blurs" off or press Clear all. When you close the
browser, its code stops running on the site, and the access itself is removed
the next time the browser starts. You can also remove it yourself at any time
from Smudge's Details page at `chrome://extensions`.

## Screenshots

The "Save screenshot" button captures the visible area of the current tab and
saves it to your computer's Downloads folder using your browser's normal
download mechanism. The image is not uploaded anywhere.

## A note on what blurring is and is not

Smudge blurs content visually so it does not appear in a screenshot or a screen
share. The underlying text still exists in the web page itself. Blurring is not
a security control and should not be relied on to protect information from a
determined party with access to the page.

## Changes

If this policy changes, the updated version will be published at this same
address with a new date at the top.

## Contact

Questions about this policy, or about Smudge: aguptaworkspace@gmail.com
