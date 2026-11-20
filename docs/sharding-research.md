# Multi-device sharding (research)

Open research, nothing built. Summary in the README roadmap.

**Problem**: a model that doesn't fit on one device can't be served. Sharding over the internet isn't viable (every token crosses every stage, each hop adds a round trip, a dropped phone kills the request), and LiteRT-LM's public API has no layer-range execution or activation export.

**Direction**: an opt-in **local cluster mode**: devices on one LAN/switch (sub-millisecond RTT) serve one model as a pipeline of layer-range stages, presented to the gateway as one logical node (behind `NodeChannel`/placement). Stay on Google's runtime: per-stage model conversion plus a custom decode loop (KV cache, sampling) on LiteRT below LiteRT-LM's engine API, or a LiteRT-LM fork, and direct node-to-node links inside the site (the gateway link stays outbound).

**Findings** (from the LiteRT-LM sources and one real file, Qwen3-0.6B `.litertlm`): the public `Engine`/`Session` has no layer-range or hidden-state hooks, but the internal `LlmExecutor` is a plausible seam (KV cache as explicit tensor buffers, prefill and decode as separate signatures). The file is one TFLite graph with `prefill_128`/`prefill_1024`/`decode` signatures, per-layer `kv_cache_k_N`/`kv_cache_v_N` inputs/outputs and layer-scoped tensor names. The exporter (`litert-torch export_hf`) wraps a PyTorch module, so a stage is likely a PyTorch-level change, not flatbuffer surgery.

**Spike (offline, tiny random Qwen3, 4 layers, fp32)**: two stages (layers 0-1, 2-3) exported with the stock flow from per-stage checkpoints (first stage: final norm and LM head replaced by identity; second: `--externalize_embedder`). Run back to back through `decode`, they reproduced the unsplit logits exactly (24/24 tokens), each holding only its own KV cache, handing over hidden size × 4 bytes per token (~4 KB for Qwen3-0.6B).

**Not yet shown**: stage-aware prefill (the exporter's prefill emits no per-position hidden states), a real or quantised model, sliding-window / per-layer-embedding architectures, execution inside LiteRT-LM's executor, whether the exporter can emit layer-range graphs directly, NPU builds (precompiled, not splittable).

**Next**: stage-aware prefill, a real model, then a LiteRT-LM stage executor, then two devices on one LAN measuring per-token latency. Until then, larger models are handled by capability reporting, per-model minimum requirements and quantisation.
