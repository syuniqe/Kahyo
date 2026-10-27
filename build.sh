#!/bin/sh
# Cloudflare build: copy only the app into dist, so notes and tests are never served.
set -e
rm -rf dist
mkdir dist
cp -r index.html css js assets vendor dist/
