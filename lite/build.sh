#!/bin/sh
# Builds dist/ModCut/ModCut-win_x64.exe: one self-contained exe using Windows' built-in WebView2.
set -e
cd "$(dirname "$0")"
ROOT=..
NEU=6.5.0
(cd $ROOT && node build.mjs)
# Neutralino runtime + client (downloaded once)
if [ ! -f bin/neutralino-win_x64.orig.exe ]; then
  mkdir -p bin
  curl -sSL -o /tmp/neu.zip https://github.com/neutralinojs/neutralinojs/releases/download/v$NEU/neutralinojs-v$NEU.zip
  unzip -oq /tmp/neu.zip -d bin && cp bin/neutralino-win_x64.exe bin/neutralino-win_x64.orig.exe
  node patch-icon.mjs   # ModCut icon + version info, before resources are embedded
fi
mkdir -p resources/vendor
[ -f resources/neutralino.js ] || curl -sSL -o resources/neutralino.js https://github.com/neutralinojs/neutralino.js/releases/download/v$NEU/neutralino.js
cp $ROOT/app/bundle.js $ROOT/app/style.css $ROOT/app/geo-core.js $ROOT/app/geo-worker.js $ROOT/app/step-worker.js \
   $ROOT/app/print-est.js $ROOT/app/orient-worker.js $ROOT/app/icon.png resources/
cp $ROOT/app/vendor/* resources/vendor/
cp native-neu.js resources/
# index.html: drop the Electron CSP, load Neutralino client + adapter instead of the bundle directly
sed -e '/Content-Security-Policy/d' \
    -e 's#<script src="bundle.js"></script>#<script src="neutralino.js"></script>\n<script src="native-neu.js"></script>#' \
    $ROOT/app/index.html > resources/index.html
npx --prefix $ROOT neu build --embed-resources
echo "Built: $(pwd)/dist/ModCut/ModCut-win_x64.exe"
