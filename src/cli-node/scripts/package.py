#!/usr/bin/env python3
"""Builds the release archive for one target: the binary plus the engine library next to it (`litert/`), as
splitcortex-node-<target>.tar.gz (zip on Windows) with a .sha256 file beside it. Run after `cargo build --release
--target <target>` and `fetch-litert.py <target> --required`. Usage: package.py <target> [out-dir]
The archive's files go straight into the install folder (see install.sh and `splitcortex-node update`)."""
import hashlib
import sys
import tarfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
target = sys.argv[1] if len(sys.argv) > 1 else sys.exit("Usage: package.py <target> [out-dir]")
out = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "dist"
windows = "windows" in target
exe = "splitcortex-node.exe" if windows else "splitcortex-node"
binary = root / "target" / target / "release" / exe
if not binary.exists():
    binary = root / "target" / "release" / exe
libs = sorted((root / "litert").glob("*litert-lm*"))
if not binary.exists() or not libs:
    sys.exit(f"missing the binary ({binary}) or the engine library (litert/)")
out.mkdir(exist_ok=True)
name = f"splitcortex-node-{target}.{'zip' if windows else 'tar.gz'}"
archive = out / name
files = [(binary, exe)] + [(lib, f"litert/{lib.name}") for lib in libs if lib.is_file()]
if windows:
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in files:
            z.write(src, arc)
else:
    with tarfile.open(archive, "w:gz") as t:
        for src, arc in files:
            info = t.gettarinfo(str(src), arc)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode = 0o755 if arc == exe else 0o644
            with open(src, "rb") as f:
                t.addfile(info, f)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / f"{name}.sha256").write_text(f"{digest}  {name}\n")
print(f"{archive} ({archive.stat().st_size / 1048576:.0f} MiB) sha256 {digest}")
