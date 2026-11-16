#!/usr/bin/env bash
# Regenerates src/protocol/gen from the single source of the node protocol, src/gateway/proto (the gateway's Docker
# build context stays src/gateway, so the proto lives there and the node app commits its generated copy).
# Needs `protoc` on PATH. Run after every change to node.proto, and commit the result.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf src/protocol/gen
mkdir -p src/protocol/gen
protoc -I ../gateway/proto \
  --plugin=protoc-gen-es=node_modules/.bin/protoc-gen-es \
  --es_out=src/protocol/gen --es_opt=target=ts,import_extension=none \
  ../gateway/proto/splitcortex/node/v1/node.proto
