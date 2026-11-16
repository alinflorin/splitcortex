//! The node protocol, generated at build time from `src/gateway/proto` (the single source).
#![allow(clippy::all, clippy::pedantic, dead_code)]
include!(concat!(env!("OUT_DIR"), "/splitcortex.node.v1.rs"));
