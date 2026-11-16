#!/usr/bin/env python3
"""Builds latest.json (the Tauri updater feed) from the assets of a desktop release.

The build jobs run in parallel, so the feed is built once, afterwards, from what the release holds.
Usage: make-latest-json.py <owner/repo> <tag>   (needs `gh`; writes ./latest.json)."""
import json
import subprocess
import sys
import urllib.request

repo, tag = sys.argv[1], sys.argv[2]
rel = json.loads(subprocess.check_output(["gh", "api", f"repos/{repo}/releases/tags/{tag}"]))
assets = {a["name"]: a for a in rel["assets"]}

# (file suffix, platform keys); the updater bundle must have a .sig next to it
RULES = [
    ("_aarch64.app.tar.gz", ["darwin-aarch64", "darwin-aarch64-app"]),
    ("_amd64.AppImage", ["linux-x86_64", "linux-x86_64-appimage"]),
    ("_aarch64.AppImage", ["linux-aarch64", "linux-aarch64-appimage"]),
    ("_x64-setup.exe", ["windows-x86_64", "windows-x86_64-nsis"]),
]
platforms = {}
for name, a in assets.items():
    for suffix, keys in RULES:
        if name.endswith(suffix) and name + ".sig" in assets:
            with urllib.request.urlopen(assets[name + ".sig"]["browser_download_url"]) as r:
                sig = r.read().decode().strip()
            for k in keys:
                platforms[k] = {"signature": sig, "url": a["browser_download_url"]}
if not platforms:
    sys.exit(f"no updater bundles with a .sig found in {tag}")
out = {
    "version": tag.removeprefix("desktop-node-v"),
    "notes": rel.get("body") or "",
    "pub_date": rel["published_at"] or rel["created_at"],
    "platforms": platforms,
}
json.dump(out, open("latest.json", "w"), indent=2)
print("platforms:", ", ".join(sorted(platforms)))
