# Build context: src/gateway (the protobuf source lives in src/gateway/proto, so no other folder is needed)
FROM rust:1-slim AS build
WORKDIR /app
# Dependencies first, so source edits do not rebuild them.
COPY Cargo.toml Cargo.lock build.rs ./
COPY proto ./proto
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:stable-slim
COPY --from=build /app/target/release/splitcortex-gateway /usr/local/bin/gateway
USER 1000:1000
ENV PORT=8080
EXPOSE 8080
CMD ["gateway"]
