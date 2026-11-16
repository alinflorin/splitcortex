// Generates the protobuf types from the single source of truth, `proto/` inside this folder (pure Rust, no protoc needed).
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_root = std::path::Path::new("proto");
    let file = "splitcortex/node/v1/node.proto";
    println!("cargo:rerun-if-changed={}", proto_root.join(file).display());
    let fds = protox::compile([file], [proto_root])?;
    prost_build::compile_fds(fds)?;
    Ok(())
}
