# Privacy Policy for Smudge

_Last updated: 19 October 2026_

## Summary

Smudge does not collect, store, transmit, or sell any data. Everything the
extension does happens inside your browser, on your own computer.

## What Smudge does

When you click "Scan & blur this page", Smudge reads the text of the page you
are currently viewing in order to find patterns that look like personal
details — email addresses, phone numbers, payment card numbers and Social
Security numbers — and applies a visual blur to them.

That reading happens entirely in your browser's memory. The page text is never
written to disk, never sent over the network, and never shared with the
developer or anyone else.

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

Smudge stores nothing. It does not use `chrome.storage`, cookies,
`localStorage`, or any other persistence. Blurs exist only in the current page
and disappear when you reload or close it.

## Permissions

Smudge requests two permissions, and no host permissions:

- **activeTab** — temporary access to the single tab you are currently viewing,
  granted only at the moment you click the Smudge toolbar button, and revoked
  when you navigate away. Smudge cannot read any page you have not explicitly
  pointed it at.
- **scripting** — to inject the detection and blurring code into that page when
  you ask it to. Smudge deliberately does not register an automatic content
  script, so none of its code runs on any page until you click the button.

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
