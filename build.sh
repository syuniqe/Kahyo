#!/bin/sh
# Cloudflare build: copy only the app into dist, so notes and tests are never served,
# then minify our scripts so the maths and prompts are not shipped readable.
set -e
rm -rf dist
mkdir dist
cp -r index.html css js assets vendor dist/
for f in nsmm llm app sample; do
  npx --yes terser@5.31.6 "js/$f.js" --compress --mangle --toplevel --comments false -o "dist/js/$f.js" \
    || echo "warning: could not minify js/$f.js, shipping it as is"
done
