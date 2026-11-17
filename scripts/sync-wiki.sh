#!/usr/bin/env bash
# Mirrors README.md (as Home) and docs/*.md into a checkout of the GitHub wiki repo, rewriting links:
#   sibling doc links (x.md, x.md#a)   -> wiki page links (x, x#a)
#   other relative links (../CLAUDE.md) -> absolute blob URLs on the default branch
# Usage: scripts/sync-wiki.sh <wiki-checkout-dir> <owner/repo> [branch]
set -euo pipefail

wiki=${1:?wiki checkout dir}
repo=${2:?owner/repo}
branch=${3:-main}
root=$(cd "$(dirname "$0")/.." && pwd)
blob="https://github.com/$repo/blob/$branch"

# Regenerated from scratch so deleted docs disappear from the wiki.
find "$wiki" -maxdepth 1 -name '*.md' -delete

rewrite() { # $1 = directory of the source file relative to the repo root ("" or "docs"); reads stdin, writes stdout
  perl -pe '
    BEGIN { $dir = shift @ARGV; $blob = shift @ARGV }
    s{\]\(((?!https?:|mailto:|#)[^)\s]+)\)}{
      my ($t, $a) = split /#/, $1, 2;
      my $anchor = defined $a ? "#$a" : "";
      if ($t =~ m{^[A-Za-z0-9_-]+\.md$} && $dir eq "docs") { (my $p = $t) =~ s/\.md$//; "]($p$anchor)" }
      else {
        my @parts = grep { length } split m{/}, ($dir eq "" ? $t : "$dir/$t");
        my @out;
        for (@parts) { if ($_ eq "..") { pop @out } elsif ($_ ne ".") { push @out, $_ } }
        "](" . $blob . "/" . join("/", @out) . $anchor . ")";
      }
    }ge;
  ' "$1" "$blob"
}

rewrite "" <"$root/README.md" >"$wiki/Home.md"

pages=()
for f in "$root"/docs/*.md; do
  name=$(basename "$f" .md)
  rewrite docs <"$f" >"$wiki/$name.md"
  pages+=("$name")
done

{
  echo "**[Home](Home)**"
  echo
  for name in "${pages[@]}"; do
    title=$(sed -n 's/^# //p;T;q' "$root/docs/$name.md" | sed 's/ (`.*//; s/`//g')
    echo "- [${title:-$name}]($name)"
  done
} >"$wiki/_Sidebar.md"
