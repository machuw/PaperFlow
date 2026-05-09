#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
PKG_VERSION=$(node -p "require('./package.json').version")

if [ "$VERSION" != "$PKG_VERSION" ]; then
  echo "❌ version mismatch: manifest.json=$VERSION, package.json=$PKG_VERSION"
  echo "   bump both before releasing."
  exit 1
fi

OUTPUT="paperflow-v${VERSION}.zip"

echo "📦 building production bundle (v${VERSION})..."
rm -rf dist
npm run build

echo "🔍 verifying production env..."
if grep -rq "127.0.0.1:54321" dist/assets/ 2>/dev/null; then
  echo "❌ found local supabase URL (127.0.0.1:54321) in dist/assets/"
  echo "   this looks like a build:dev output — re-run with npm run build."
  exit 1
fi

if [ ! -f dist/manifest.json ] || [ ! -d dist/icons ]; then
  echo "❌ dist/ missing manifest.json or icons/ — build incomplete?"
  exit 1
fi

rm -f "$OUTPUT"

echo "🗜  zipping dist/ → $OUTPUT..."
( cd dist && zip -qr "../$OUTPUT" . -x "*_metadata/*" -x "*.DS_Store" )

SIZE=$(du -h "$OUTPUT" | cut -f1)

cat <<EOF

✅ released: $OUTPUT ($SIZE)

📥 install instructions for colleagues:
  1. unzip $OUTPUT
  2. open chrome://extensions/
  3. toggle "Developer mode" (top right)
  4. click "Load unpacked" → select the unzipped folder

⚠️  chrome will show a yellow warning bar each launch
    ("disable developer mode extensions") — that's expected for unpacked installs.
EOF
