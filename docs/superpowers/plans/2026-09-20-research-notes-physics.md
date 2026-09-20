# Notas de pesquisa — plano de física

## OBB/SAT
- dyn4j SAT: SAT aplica-se a formas convexas; pode retornar o Minimum Translation Vector (MTV), escolhendo o eixo com menor overlap. A detecção e a resolução são problemas diferentes; em múltiplos corpos, o MTV local não resolve sozinho o problema global.
- Fonte: https://dyn4j.org/2010/01/sat/

## Manifold/TOI
- Box2D collision docs: polygon-polygon pode gerar dois pontos com a mesma normal; esses pontos formam um manifold e o solver usa essa estrutura para melhorar a estabilidade de empilhamento. A documentação também destaca cache para warm start e Time of Impact para reduzir tunneling.
- Fonte: https://box2d.org/documentation/md_collision.html

## Corpos cinemáticos
- Rapier separa fixed, dynamic, kinematic position-based e kinematic velocity-based. O primeiro deriva velocidade a partir da pose seguinte; o segundo usa a velocidade definida pelo usuário. Ambos dão controle da trajetória ao usuário, mas têm semânticas distintas e não devem ser representados apenas como invMass zero.
- Fonte: https://rapier.rs/docs/user_guides/rust/rigid_bodies/

## Determinismo
- Gaffer On Games: determinismo significa mesmo estado inicial + mesmas entradas produzirem exatamente o mesmo estado, inclusive bit a bit. Ordem de processamento e diferenças de floating point entre compiladores, SOs e arquiteturas podem quebrar a garantia. Fixed timestep é pré-condição, mas não é suficiente.
- Fonte: https://gafferongames.com/post/deterministic_lockstep/

## Implicações para rts-game
1. OBB deve retornar não só hit, mas normal consistente, profundidade, feature id e dados suficientes para gerar/reutilizar manifold.
2. SAT/MTV não deve ser usado como se fosse o solver completo; a resposta deve ser um sistema de constraints por contato.
3. Manifold precisa sobreviver entre steps e usar IDs de features, não apenas posição aproximada, para casar contatos e warm-start.
4. Kinematic precisa carregar pose alvo/velocidade e não ser tratado como teleporte que zera velocidade.
5. O contrato de determinismo deve especificar escopo: mesmo binário/máquina ou entre plataformas.

## Estado local relevante
- `Transform` só possui Euler (`rx, ry, rz` local; `wrx, wry` no mundo), velocidade linear e massa; não há quaternion, velocidade angular ou inércia.
- `gpurigid.ts` usa `pos/vel/ext/world`, todos os 16 floats por corpo já ocupados.
- `scene.ts` resolve AABB, esfera e caixa-esfera; há suporte CPU para casca, mas GPU/Rust caem para CPU quando há casca.
- `physics_backend.ts` sincroniza posição/velocidade e zera velocidades quando detecta movimento externo.
- `rbSyncStatics()` não aplica centro local/rotação do `Collider`; `cpurigid.ts` documenta divergência semelhante.
- Plano do próprio projeto: `docs/superpowers/specs/2026-09-20-paralelismo-e-fundacao-design.md`, seção 7, já ordena ponto de contato → OBB → dinâmica angular → manifold warm starting, mas também reconhece que layout, máscaras e canal de contatos precisam ser decididos antes.


## Otimização e arquitetura
- Box2D Simulation Islands: corpos e constraints formam um grafo; ilhas são componentes conectados. Sleeping deve ser por ilha, e acordar deve propagar pelos contatos. Ilhas independentes podem rodar em threads, mas uma grande pilha ainda limita o scaling. Parallel union-find pode tornar a ordem de constraints não determinística; a ordem precisa ser estabilizada se o solver for Gauss-Seidel/warm-start.
- Fonte: https://box2d.org/posts/2023/10/simulation-islands/

- Box2D Simulation docs: pipeline separado em find pairs, contacts persistentes, rebuild do BVH, narrow phase, merge/split islands e solver. Narrow phase deve gerar contacts antes do movimento/impulsos do passo. CCD usa sweep/TOI para evitar tunneling. Queries e eventos têm custo/ordem próprios.
- Fonte: https://box2d.org/documentation/md_simulation.html

- PhysX GPU docs: GPU pode acelerar broad phase, geração de contatos, gestão de shapes/bodies e solver, mas CCD, triggers e algumas features continuam CPU. Buffers GPU precisam ser pré-alocados; overflow de contacts/constraints/pairs pode degradar comportamento. Re-sincronização de poses/velocidades tem custo que deve ser medido.
- Fonte: https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/GPURigidBodies.html

- Unity CCD docs: CCD é uma rede de segurança preditiva; é mais caro que simulação discreta e pode ser sweep-based ou speculative. Deve ser seletivo, por exemplo para projéteis e corpos rápidos, não habilitado globalmente sem orçamento.
- Fonte: https://docs.unity3d.com/6000.6/Documentation/Manual/ContinuousCollisionDetection.html

- Gaffer Floating Point Determinism: determinismo entre plataformas exige restringir compilador, arquitetura e operações FP ou aceitar que replay é apenas por build/máquina. Não prometer lockstep cross-platform sem experimento explícito.
- Fonte: https://gafferongames.com/post/floating_point_determinism/

## Recomendações adicionais para o super-plano
1. Separar broad-phase, persistent contact manager, narrow phase, island builder, solver, CCD e queries como fases com buffers/contratos próprios.
2. Fazer sleeping e wake-up por ilha, não apenas por corpo.
3. Persistir pares e manifolds; não reconstruir tudo como arrays temporários a cada frame.
4. Introduzir CCD seletivo por budget e velocidade, com TOI para projéteis; não usar o teto de velocidade como substituto universal.
5. GPU deve ter limites, contadores de overflow e fallback explícito; nenhum pair/contact pode simplesmente desaparecer sem diagnóstico.
6. Medir CPU/GPU separadamente e não assumir que GPU acelera eventos, CCD, triggers ou readback.
7. Definir perfis de determinismo: replay same binary/machine, replay same architecture, e cross-platform somente após prova.
