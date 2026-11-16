#!/usr/bin/env python3
"""Downloads Google's official LiteRT-LM C API release (a zip of headers and per-platform shared libraries), checks its
SHA-256 against the pinned value and copies the library for one target into litert/, from where the release archive
ships it next to the binary (loaded at run time, see src/engine). Usage:
  python3 scripts/fetch-litert.py [rust-target-triple] [--required]
Without a triple it uses the host's. A target Google publishes no library for (macOS x86_64) gets nothing: the binary
builds, but the engine reports that it is unavailable. --required fails on such a target instead.
Same pin as src/desktop-node/scripts/fetch-litert.mjs; bump both together."""
import hashlib
import io
import re
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

VERSION = "v0.19.1"
ASSET = "litert_lm_c_api-1.0.0.zip"
SHA256 = "1d430d80eaf536f696a4922270ba55eb3d112189ac198c3066d487a45e3b4d4c"
URL = f"https://github.com/google-ai-edge/LiteRT-LM/releases/download/{VERSION}/{ASSET}"

# rust target -> (path inside the zip, file name the binary looks for)
LIBS = {
    "x86_64-unknown-linux-gnu": ("lib/linux_x86_64/liblitert-lm.so", "liblitert-lm.so"),
    "aarch64-unknown-linux-gnu": ("lib/linux_arm64/liblitert-lm.so", "liblitert-lm.so"),
    "aarch64-apple-darwin": ("lib/macos_arm64/liblitert-lm.dylib", "liblitert-lm.dylib"),
    "x86_64-pc-windows-msvc": ("lib/windows_x86_64/bin/litert-lm.dll", "litert-lm.dll"),
}

args = sys.argv[1:]
required = "--required" in args
triple = next((a for a in args if not a.startswith("--")), None)
if triple is None:
    triple = re.search(r"^host: (.+)$", subprocess.check_output(["rustc", "-vV"], text=True), re.M).group(1)

root = Path(__file__).resolve().parent.parent / "litert"
root.mkdir(exist_ok=True)
for f in root.iterdir():
    if f.name != ".cache" and f.is_file():
        f.unlink()

entry = LIBS.get(triple)
if entry is None:
    msg = f"No LiteRT-LM library is published for {triple}; the engine will be unavailable in this build."
    if required:
        sys.exit(msg)
    print(msg)
    sys.exit(0)

cache = root / ".cache"
cache.mkdir(exist_ok=True)
zip_path = cache / f"{VERSION}-{ASSET}"
data = zip_path.read_bytes() if zip_path.exists() else b""
if hashlib.sha256(data).hexdigest() != SHA256:
    print(f"Downloading {URL}")
    with urllib.request.urlopen(URL) as r:
        data = r.read()
    got = hashlib.sha256(data).hexdigest()
    if got != SHA256:
        sys.exit(f"Checksum mismatch for {ASSET}: expected {SHA256}, got {got}")
    zip_path.write_bytes(data)
inside, out_name = entry
with zipfile.ZipFile(io.BytesIO(data)) as z:
    lib = z.read(inside)
(root / out_name).write_bytes(lib)
print(f"LiteRT-LM {VERSION}: {out_name} for {triple} ({len(lib) / 1048576:.0f} MiB)")
