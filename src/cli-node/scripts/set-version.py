#!/usr/bin/env python3
"""Sets the crate version from the release tag (CI builds `cli-node-vX.Y.Z` as exactly X.Y.Z). Usage: set-version.py X.Y.Z"""
import re
import sys
from pathlib import Path

version = sys.argv[1] if len(sys.argv) > 1 else ""
if not re.fullmatch(r"\d+\.\d+\.\d+", version):
    sys.exit("Usage: set-version.py X.Y.Z")
p = Path(__file__).resolve().parent.parent / "Cargo.toml"
p.write_text(re.sub(r'^version = "[^"]*"', f'version = "{version}"', p.read_text(), count=1, flags=re.M))
print(f"Version set to {version}")
