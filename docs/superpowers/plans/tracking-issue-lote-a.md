## Contexto e Objetivo

Acompanhamento da execução do **Lote A** da Fase 2 de física, conforme planejado em #1, formalizado no PR #2 (Revisão 3 da spec de paralelismo) e detalhado em `docs/superpowers/plans/2026-09-20-antigravity-review-and-future-roadmap.md`.

Esta issue serve como quadro público de progresso para os colaboradores e modelos (Manus, Claude, etc.) acompanharem o status da implementação.

---

## Branches de Trabalho

- **`rts-game`**: `feature/lote-a-fundacao-layout`
- **`rts`**: `feature/lote-a-wgpu-limits`

---

## Checklist de Tarefas do Lote A

- [x] **1. Host wgpu (`rts`):** Elevar `max_storage_buffers_per_shader_stage = 8` sobre `downlevel_defaults()` em `crates/rts-egui/src/frame/gpu.rs:178-185`. (Elimina o falso teto de 4 buffers sem inflar a memória do editor).
- [ ] **2. Paridade dos Estáticos com Offset (`rts-game`):** Corrigir `rbSyncStatics` (`gpurigid.ts`) e `crSyncStatics` (`cpurigid.ts`) para somar `centerLocal*` rotacionado por yaw, alinhando com o solver CPU (`scene.ts:813-822`).
- [ ] **3. Semântica de Cinemáticos (`rts-game`):** Ajustar `pbEmpurraTeleportes` (`src/engine/core/physics_backend.ts:597-610`) para zerar a velocidade apenas para corpos dinâmicos, preservando a velocidade de agentes/plataformas cinemáticos movidos por scripts ou navegação.
- [ ] **4. Layout Versionado e Tipos (`rts-game` + `rts`):** 
  - `pose`: `[pos.xyz, sleep, quat.xyzw]`
  - `motion`: `[vel.xyz, invMass, angVel.xyz, flags]`
  - `world_tail`: meias-extensões, inércia inversa, layer, mask, shape/hullId.
  - Tipos canônicos: `static = 0`, `kinematic = 1`, `dynamic = 2`.
- [ ] **5. Testes e Critério de Aceite:**
  - Validar 27 testes do jogo (`rts.exe run tests/*.ts`).
  - Validar 36 testes do crate (`cargo test --release -p rts-physics`).
  - Testes de paridade novos: estáticos deslocados e cinemáticos em movimento.
  - Portão de regressão: perda < 5% no nível `simples`.
