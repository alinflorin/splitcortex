#!/bin/sh
# Installs the SplitCortex command line node on Linux (x86_64, arm64) or macOS (Apple silicon):
#   curl -fsSL https://raw.githubusercontent.com/alinflorin/splitcortex/main/src/cli-node/install.sh | sh
# Downloads the newest cli-node-vX.Y.Z release for this machine from GitHub, checks its SHA-256 and unpacks it into
# ~/.local/lib/splitcortex-node (the binary and the engine library next to it), with a link in ~/.local/bin.
# Environment: SPLITCORTEX_VERSION=X.Y.Z installs that version; SPLITCORTEX_INSTALL_DIR changes the folder;
# SPLITCORTEX_DOWNLOAD_BASE replaces the release download address (for testing a build).
# Remove it again: rm -rf ~/.local/lib/splitcortex-node ~/.local/bin/splitcortex-node
set -eu

REPO="alinflorin/splitcortex"
INSTALL_DIR="${SPLITCORTEX_INSTALL_DIR:-$HOME/.local/lib/splitcortex-node}"
BIN_DIR="${SPLITCORTEX_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have curl || die "curl is required"
have tar || die "tar is required"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64 | Linux-arm64) TARGET="aarch64-unknown-linux-gnu" ;;
  Darwin-arm64) TARGET="aarch64-apple-darwin" ;;
  Darwin-x86_64) die "Intel Macs are not supported: Google publishes no LiteRT-LM library for them" ;;
  *) die "unsupported platform: $(uname -s) $(uname -m)" ;;
esac

if [ -n "${SPLITCORTEX_VERSION:-}" ]; then
  VERSION="${SPLITCORTEX_VERSION#v}"
else
  # The command line node has its own release stream (cli-node-v*); the repository's "latest" release is the server's.
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=50" |
    grep -o '"tag_name": *"cli-node-v[0-9][0-9.]*"' |
    sed 's/.*cli-node-v//; s/"//' |
    sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)"
  [ -n "$VERSION" ] || die "no cli-node release found at github.com/$REPO/releases"
fi

NAME="splitcortex-node-$TARGET.tar.gz"
URL="${SPLITCORTEX_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download/cli-node-v$VERSION}/$NAME"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "Installing SplitCortex node $VERSION for $TARGET"
curl -fsSL -o "$TMP/$NAME" "$URL" || die "cannot download $URL"
curl -fsSL -o "$TMP/$NAME.sha256" "$URL.sha256" || die "cannot download the checksum"

EXPECTED="$(cut -d' ' -f1 "$TMP/$NAME.sha256")"
if have sha256sum; then
  ACTUAL="$(sha256sum "$TMP/$NAME" | cut -d' ' -f1)"
elif have shasum; then
  ACTUAL="$(shasum -a 256 "$TMP/$NAME" | cut -d' ' -f1)"
else
  die "sha256sum or shasum is required to verify the download"
fi
[ "$EXPECTED" = "$ACTUAL" ] || die "the download does not match its checksum"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
tar -xzf "$TMP/$NAME" -C "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR/splitcortex-node"
ln -sf "$INSTALL_DIR/splitcortex-node" "$BIN_DIR/splitcortex-node"

say ""
say "Installed: $BIN_DIR/splitcortex-node ($VERSION)"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "Add $BIN_DIR to your PATH to run it by name, e.g.:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
say ""
say "Next:"
say "  splitcortex-node join              enroll with the code from \"Add device\" in the web app"
say "  splitcortex-node run               start serving (Ctrl+C stops)"
say "  splitcortex-node service install   or keep it running in the background and at login"
