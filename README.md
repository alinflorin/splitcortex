# SplitCortex

SplitCortex is a SaaS platform that turns idle mobile compute (phones, Raspberry Pis, other small devices) into inference serving nodes. Users bring their devices, group them into pools, and serve models through a single managed API.

> Status: early design. No implementation yet; this document describes the intended scope.

## What it does

- **Accounts and organisations**: users register, create organisations, and manage memberships and roles.
- **Inference pools**: an organisation groups its devices into pools. Each pool serves a set of models.
- **API keys**: per-organisation key management for clients calling the inference API.
- **API gateway**: the platform is the single public entry point. It authenticates requests, load-balances them across the nodes in a pool, and manages model distribution.
- **Device nodes**: endpoint devices keep a persistent gRPC stream to the gateway over TLS (no message broker). The gateway pushes work down this stream, so devices do not need to be publicly reachable.
- **Usage tracking and limits**: token usage is metered per key, pool and organisation, with configurable limits.
- **Dashboards and config pages**: usage, node health, pool state, and settings in the web UI.

## Architecture (high level)

```
 clients ──HTTPS──▶  gateway (auth, limits, metering, load balancing, model mgmt)
                          │
                          │  persistent gRPC stream over TLS
                          ▼
                    device nodes (phone / RPi / ...)
                          └─ inference engine: LiteRT-LM
```

- Nodes connect outbound to the gateway, so NAT and mobile networks are not a problem.
- **Node and server identity**: each node generates its own key pair and registers its public key when it enrolls. The server has its own key pair, which nodes trust from enrollment onwards. The two sides authenticate each other with these keys.
- **Models are currently replicated**: every device in a pool holds a full copy of the pool's models.
- **Engine**: LiteRT-LM is the only supported inference engine for now.

## Roadmap / open research

- **Sharding large models across multiple devices.** Models that do not fit on a single device cannot be served today. We need to investigate how to split a model over several devices (pipeline/tensor parallelism over weak, high-latency links) and what the engine supports.
- Additional inference engines beyond LiteRT-LM.

## Tech stack

- **Frontend**: Vite, React, TypeScript, Fluent UI, react-hook-form, zod.
- **Endpoint app**: React Native with Expo and TypeScript, run on physical devices via local dev builds (no EAS). A native module wraps LiteRT-LM, so Expo Go is not supported.
- **Backend**: not decided. Leaning towards a cloud solution such as Supabase for auth and data. The gateway, which holds long-lived node connections, will likely need its own always-on service.

## Repository layout

Not yet established. This section will be filled in as the codebase takes shape.

## Getting started

Not yet available.

## License

TBD.
