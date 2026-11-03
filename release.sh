#!/usr/bin/env bash
# release.sh — bump version, verify, pack, commit, tag, push.
#
# GitHub Actions owns publication now. Pushing the tag triggers
# .github/workflows/release.yml, which builds every target and creates the
# GitHub release with deterministic ZIPs + SHA-256 checksums.
#
# Usage:
#   ./release.sh patch       # 2.0.0 → 2.0.1 (bug fix)
#   ./release.sh minor       # 2.0.0 → 2.1.0 (new feature)
#   ./release.sh major       # 2.0.0 → 3.0.0 (breaking change)
#   ./release.sh 2.0.1       # explicit version

set -euo pipefail

cd "$(dirname "$0")"

if [ $# -lt 1 ]; then
  echo "usage: $0 <patch|minor|major|x.y.z>" >&2
  exit 64
fi

CUR=$(node -p "require('./manifest.json').version")
case "$1" in
  patch) NEW=$(node -e "const [a,b,c]='$CUR'.split('.').map(Number); console.log([a,b,c+1].join('.'))") ;;
  minor) NEW=$(node -e "const [a,b]='$CUR'.split('.').map(Number); console.log([a,b+1,0].join('.'))") ;;
  major) NEW=$(node -e "const [a]='$CUR'.split('.').map(Number); console.log([a+1,0,0].join('.'))") ;;
  *)     NEW="$1" ;;
esac
NEW="${NEW#v}"

echo "Bumping $CUR → $NEW"

# Update manifest.json, package.json, content.js, and the README badge in lock-step.
node -e "
const fs = require('fs');
const version = '$NEW';
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
m.version = version;
m.version_name = version;
fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2) + '\n');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = version;
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
let c = fs.readFileSync('content.js', 'utf8');
c = c.replace(/const LUMEO_VERSION = \"[^\"]+\";/, 'const LUMEO_VERSION = \"' + version + '\";');
fs.writeFileSync('content.js', c);
let r = fs.readFileSync('README.md', 'utf8');
r = r.replace(/(badge\/version-)\d+\.\d+\.\d+/, '\$1' + version);
fs.writeFileSync('README.md', r);
"

# Fail before tagging if CHANGELOG/README/package/content drift.
node scripts/check-versions.mjs

if ! grep -q "^## \[$NEW\]" CHANGELOG.md; then
  echo "CHANGELOG.md is missing a '## [$NEW]' section. Add release notes, then re-run." >&2
  exit 1
fi

npm run check:all
npm test
./pack.sh "$NEW"

echo
git diff --stat manifest.json package.json content.js README.md CHANGELOG.md
echo
read -r -p "Looks right? Commit + tag + push? [y/N] " ans
[ "$ans" = "y" ] || { echo "aborted; files were updated locally but not committed"; exit 1; }

git add manifest.json package.json content.js README.md CHANGELOG.md
git commit -m "chore: release v$NEW"
git tag -a "v$NEW" -m "v$NEW"
git push
git push --tags

echo
echo "✓ Pushed v$NEW"
echo "  GitHub Actions will build Chrome, Edge, Firefox, and Opera packages and publish the release."
echo "  https://github.com/ThanhNguyxnOrg/lumeo/actions/workflows/release.yml"
echo
echo "Next: download the target ZIPs from the GitHub release and upload them to the stores you use."
