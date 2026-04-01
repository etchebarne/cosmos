#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

CURRENT=$(grep -oP '"version": "\K[^"]+' package.json)

if [ $# -eq 0 ]; then
    echo "Current version: $CURRENT"
    echo ""
    echo "Usage: $0 <version>"
    echo "       $0 patch|minor|major"
    echo ""
    echo "Examples:"
    echo "  $0 0.2.0"
    echo "  $0 patch   # $CURRENT -> $(echo "$CURRENT" | awk -F. '{print $1"."$2"."$3+1}')"
    echo "  $0 minor   # $CURRENT -> $(echo "$CURRENT" | awk -F. '{print $1"."$2+1".0"}')"
    echo "  $0 major   # $CURRENT -> $(echo "$CURRENT" | awk -F. '{print $1+1".0.0"}')"
    exit 1
fi

NEW_VERSION="$1"

# Support patch/minor/major shortcuts
case "$NEW_VERSION" in
    patch)
        NEW_VERSION=$(echo "$CURRENT" | awk -F. '{print $1"."$2"."$3+1}')
        ;;
    minor)
        NEW_VERSION=$(echo "$CURRENT" | awk -F. '{print $1"."$2+1".0"}')
        ;;
    major)
        NEW_VERSION=$(echo "$CURRENT" | awk -F. '{print $1+1".0.0"}')
        ;;
esac

if [ "$CURRENT" = "$NEW_VERSION" ]; then
    echo "Version is already $CURRENT"
    exit 1
fi

echo "Bumping version: $CURRENT -> $NEW_VERSION"
echo ""

# package.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" package.json
echo "  updated package.json"

# tauri.conf.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
echo "  updated src-tauri/tauri.conf.json"

# Cargo.toml files
for cargo_toml in \
    src-tauri/Cargo.toml \
    src-tauri/crates/kosmos-core/Cargo.toml \
    src-tauri/crates/kosmos-protocol/Cargo.toml \
    src-tauri/crates/kosmos-agent/Cargo.toml
do
    sed -i "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" "$cargo_toml"
    echo "  updated $cargo_toml"
done

# AUR PKGBUILDs
for pkgbuild in \
    aur/kosmos/PKGBUILD \
    aur/kosmos-bin/PKGBUILD
do
    sed -i "s/^pkgver=$CURRENT/pkgver=$NEW_VERSION/" "$pkgbuild"
    echo "  updated $pkgbuild"
done

echo ""
echo "Done! Version bumped to $NEW_VERSION"
