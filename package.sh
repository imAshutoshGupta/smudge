#!/usr/bin/env bash
# Builds the upload zip for the Chrome Web Store, and refreshes the copies the
# landing page serves.
#
# Ships only what the extension needs at runtime. The test fixture and the
# icon generator are development tools — shipping them enlarges the package
# and gives a reviewer more surface to ask about.
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
OUT="build/smudge-${VERSION}.zip"
STAGE="build/stage"

FILES=(
  manifest.json
  popup.html popup.css popup.js
  content/detectors.js content/redactor.js content/index.js
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png
)

rm -rf build
mkdir -p "$STAGE"

for f in "${FILES[@]}"; do
  mkdir -p "$STAGE/$(dirname "$f")"
  cp "$f" "$STAGE/$f"
done

# Normalise timestamps before zipping. A zip records each file's mtime, so
# without this a plain `git checkout` or `pull` — which rewrites mtimes
# without changing content — produces a different zip and a spurious binary
# diff on the next commit. Identical sources should mean an identical zip.
find "$STAGE" -exec touch -t 200001010000 {} +

(cd "$STAGE" && zip -r -X "../../$OUT" . ) > /dev/null
rm -rf "$STAGE"

echo "built $OUT"
unzip -l "$OUT"

# Refresh the download and the demo assets on the landing page, and keep the
# version shown there in step with the manifest.
cp "$OUT" docs/smudge.zip
cp content/detectors.js docs/detectors.js
cp icons/icon-128.png docs/icon-128.png
sed -i '' -E "s|(<span id=\"version\">)[^<]*(</span>)|\1${VERSION}\2|" docs/index.html

echo "updated docs/ — download, demo detector, icon, version ${VERSION}"
