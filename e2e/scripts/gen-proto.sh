#!/usr/bin/env bash
# Regenerates src/perf/gen from the single source of the node protocol, src/gateway/proto (the perf suite's simulated
# nodes speak it). Needs `protoc` on PATH. Run after every change to node.proto, and commit the result.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf src/perf/gen
mkdir -p src/perf/gen
protoc -I ../src/gateway/proto \
  --plugin=protoc-gen-es=node_modules/.bin/protoc-gen-es \
  --es_out=src/perf/gen --es_opt=target=ts,import_extension=ts \
  ../src/gateway/proto/splitcortex/node/v1/node.proto
