# Build context: src/gateway (the protobuf source lives in src/gateway/proto, so no other folder is needed)
#
# One chain, so the dependencies compile once: deps -> test -> build. Tests run in the release profile (same profile and
# features as the binary), so `cargo build --release` after them only recompiles the crate itself.
FROM rust:1-slim AS deps
WORKDIR /app
ARG TARGETARCH
ARG NEXTEST_VERSION=0.9.152
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf "https://get.nexte.st/${NEXTEST_VERSION}/linux$([ "$TARGETARCH" = arm64 ] && echo -arm)" | tar zxf - -C /usr/local/cargo/bin
COPY Cargo.toml Cargo.lock build.rs ./
COPY proto ./proto
COPY .config ./.config
# Dependencies first, so source edits do not rebuild them.
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src

# Unit tests (cargo-nextest, JUnit XML). The run never fails this stage: it records reports/exit-code, so CI can export the
# report (`--target test-report`) even when tests fail; the build stage fails the image on a non-zero code.
FROM deps AS test
COPY src ./src
RUN touch src/main.rs && mkdir -p reports; cargo nextest run --release --profile ci; echo $? > reports/exit-code; \
    cp target/nextest/ci/junit.xml reports/junit.xml; true

# Only the reports, for `docker build --target test-report --output type=local,dest=<dir>`.
FROM scratch AS test-report
COPY --from=test /app/reports /

# Publishable binary: only after the tests (same layers and target dir), failing the image if they failed.
FROM test AS build
RUN [ "$(cat reports/exit-code)" = 0 ] || { echo "Unit tests failed: see the JUnit report (target test-report)"; exit 1; }
RUN touch src/main.rs && cargo build --release

FROM debian:stable-slim
COPY --from=build /app/target/release/splitcortex-gateway /usr/local/bin/gateway
USER 1000:1000
ENV PORT=8080
EXPOSE 8080
CMD ["gateway"]
