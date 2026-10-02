// GERADO por tools/generate-components.mjs. Edite as classes .ts, nao este arquivo.
export const COMPONENT_CATALOG = [
  {
    "name": "AnimationPlayer",
    "category": "Animação",
    "description": "Toca um clipe glTF do Skeleton do mesmo objeto: laço, seek, crossfade.",
    "keywords": "animacao clipe gltf esqueleto pose laco crossfade",
    "source": "src/engine/core/animation_player.ts"
  },
  {
    "name": "Animator",
    "category": "Animação",
    "description": "Máquina de estados de animação (estilo Mecanim): parâmetros, transições, mistura 1D e camadas com máscara.",
    "keywords": "animator animacao estados transicao mistura blend camada mascara mecanim controlador",
    "source": "src/engine/core/animator.ts"
  },
  {
    "name": "KeyframeAnimator",
    "category": "Animação",
    "description": "Anima propriedades com keyframes.",
    "keywords": "animacao keyframe",
    "source": "src/scripts/keyframeanimator.ts"
  },
  {
    "name": "CameraOrbita",
    "category": "Câmera",
    "description": "Órbita em volta de um alvo (nome do objeto): botão direito gira, roda aproxima.",
    "keywords": "camera câmera órbita orbita orbit alvo terceira pessoa zoom",
    "source": "assets/pacotes/camera/camera_orbita.ts"
  },
  {
    "name": "CameraPrimeiraPessoa",
    "category": "Câmera",
    "description": "Primeira pessoa: olhar com o mouse (botão direito) e andar com WASD; espaço sobe.",
    "keywords": "camera câmera fps primeira pessoa wasd mouse controle voar",
    "source": "assets/pacotes/camera/camera_primeira_pessoa.ts"
  },
  {
    "name": "CameraRTS",
    "category": "Câmera",
    "description": "Câmera de estratégia: WASD move no plano, roda muda a altura, inclinação fixa.",
    "keywords": "camera câmera rts estratégia estrategia pan zoom topo",
    "source": "assets/pacotes/camera/camera_rts.ts"
  },
  {
    "name": "CameraSeguir",
    "category": "Câmera",
    "description": "Segue um alvo (nome do objeto) a um deslocamento, com suavização, olhando para ele.",
    "keywords": "camera câmera seguir follow alvo terceira pessoa suave",
    "source": "assets/pacotes/camera/camera_seguir.ts"
  },
  {
    "name": "AutomaticDoor",
    "category": "Demo",
    "description": "Porta que abre ao receber um gatilho, espera e fecha sozinha (exemplo de startCoroutine/waitForSeconds).",
    "keywords": "demo corrotina porta gatilho startCoroutine waitForSeconds coroutine",
    "source": "assets/scripts/AutomaticDoor.ts"
  },
  {
    "name": "VitrineContador",
    "category": "Demo",
    "description": "Conta os contatos e gatilhos que este objeto recebe (cena vitrine).",
    "keywords": "demo vitrine contato evento",
    "source": "assets/scripts/VitrineContador.ts"
  },
  {
    "name": "VitrineHud",
    "category": "Demo",
    "description": "HUD da cena vitrine: fps, objetos, contatos e backend; o botao \"Derrubar\" empurra as caixas.",
    "keywords": "demo vitrine hud fps",
    "source": "assets/scripts/VitrineHud.ts"
  },
  {
    "name": "ParticleSystem",
    "category": "Efeitos",
    "description": "Emissor de partículas no modelo da Unity (Shuriken): forma, taxa/burst, curvas sobre o tempo de vida.",
    "keywords": "particula particle fogo fumaca faisca chuva efeito vfx",
    "source": "src/scripts/particlesystem.ts"
  },
  {
    "name": "Buoyancy",
    "category": "Física",
    "description": "Empuxo e arrasto de água para um Rigidbody dinâmico.",
    "keywords": "agua water buoyancy flutuacao empuxo",
    "source": "src/engine/core/buoyancy.ts"
  },
  {
    "name": "Collider",
    "category": "Física",
    "description": "Define a forma usada na colisão.",
    "keywords": "fisica colisor caixa esfera",
    "source": "src/engine/core/collider.ts"
  },
  {
    "name": "PhysicsMaterial",
    "category": "Física",
    "description": "Ajusta atrito e restituição.",
    "keywords": "fisica colisão atrito",
    "source": "src/scripts/physicsmaterial.ts"
  },
  {
    "name": "Rigidbody",
    "category": "Física",
    "description": "Aplica gravidade e movimento físico.",
    "keywords": "fisica corpo gravidade",
    "source": "src/scripts/rigidbody.ts"
  },
  {
    "name": "RouteAgent",
    "category": "IA e Navegacao",
    "description": "Segue o RoutePath do mesmo objeto: espera, vira e anda.",
    "keywords": "agente rota npc estados patrulha",
    "source": "src/engine/core/route_agent.ts"
  },
  {
    "name": "RoutePath",
    "category": "IA e Navegacao",
    "description": "Pontos XZ locais, conexoes e pausas de uma rota.",
    "keywords": "rota waypoint caminho patrulha",
    "source": "src/engine/core/route_path.ts"
  },
  {
    "name": "ProceduralWorld",
    "category": "Mundo",
    "description": "Mundo procedural com streaming, LOD e máscara de vegetação salva na cena.",
    "keywords": "terrain mundo procedural chunks vegetação árvores mato pincel",
    "source": "src/engine/core/procedural_world.ts"
  },
  {
    "name": "Terrain",
    "category": "Mundo",
    "description": "Terreno heightfield com pincel de altura e relevo salvo na cena.",
    "keywords": "terreno terrain relevo altura pincel",
    "source": "src/engine/core/terrain.ts"
  },
  {
    "name": "NetworkManager",
    "category": "Rede",
    "description": "Servidor ou cliente UDP com replicação autoritativa de GameObjects.",
    "keywords": "multiplayer network manager conexão servidor cliente",
    "source": "src/engine/core/network_manager.ts"
  },
  {
    "name": "NetworkObject",
    "category": "Rede",
    "description": "Identidade de rede; estados irmãos são replicados pelo servidor.",
    "keywords": "multiplayer network object identidade dono",
    "source": "src/engine/core/network_object.ts"
  },
  {
    "name": "NetworkTransform",
    "category": "Rede",
    "description": "Replica posição e yaw do GameObject a partir do servidor.",
    "keywords": "multiplayer network transform rede posição",
    "source": "src/engine/core/network_transform.ts"
  },
  {
    "name": "Camera",
    "category": "Renderização",
    "description": "Câmera do jogo: perspectiva ou ortográfica, viewport, fundo e ordem de desenho.",
    "keywords": "camera câmera visão perspectiva ortográfica viewport",
    "source": "src/engine/core/camera.ts"
  },
  {
    "name": "CicloDoDia",
    "category": "Renderização",
    "description": "Gira o sol e interpola as cores do céu ao longo do dia.",
    "keywords": "dia noite sol ciclo ambiente céu",
    "source": "assets/pacotes/ambiente/ciclo_do_dia.ts"
  },
  {
    "name": "Light",
    "category": "Renderização",
    "description": "Luz direcional, pontual ou spot usada pelo renderer.",
    "keywords": "luz light sol lâmpada lampada spot iluminação",
    "source": "src/engine/core/light.ts"
  },
  {
    "name": "Material",
    "category": "Renderização",
    "description": "Configura a superfície do objeto.",
    "keywords": "cor textura aparência",
    "source": "src/engine/core/material.ts"
  },
  {
    "name": "MeshRenderer",
    "category": "Renderização",
    "description": "Desenha a malha do objeto.",
    "keywords": "malha modelo mesh",
    "source": "src/engine/core/meshrenderer.ts"
  },
  {
    "name": "Skeleton",
    "category": "Renderização",
    "description": "Desenha um modelo glTF de ossos rígidos e guarda a pose posicionada à mão.",
    "keywords": "ossos esqueleto personagem glb gltf pose animação",
    "source": "src/engine/core/skeleton.ts"
  },
  {
    "name": "WaterSurface",
    "category": "Renderização",
    "description": "Água com ondas GPU, refração, absorção por profundidade e espuma nas margens.",
    "keywords": "water água rio lago oceano ondas",
    "source": "src/engine/core/water_surface.ts"
  },
  {
    "name": "Bobber",
    "category": "Scripts",
    "description": "Move o objeto para cima e baixo.",
    "keywords": "flutuar oscilar",
    "source": "src/scripts/bobber.ts"
  },
  {
    "name": "MotionSettings",
    "category": "Scripts",
    "description": "Exemplo: campos públicos viram controles automaticamente.",
    "keywords": "exemplo movimento velocidade texto booleano",
    "source": "assets/scripts/MotionSettings.ts"
  },
  {
    "name": "Mover",
    "category": "Scripts",
    "description": "Move o objeto em uma direção.",
    "keywords": "mover translação",
    "source": "src/scripts/mover.ts"
  },
  {
    "name": "Orbit",
    "category": "Scripts",
    "description": "Move o objeto em uma órbita.",
    "keywords": "orbita círculo",
    "source": "src/scripts/orbit.ts"
  },
  {
    "name": "Patrol",
    "category": "Scripts",
    "description": "Move o objeto em ida e volta.",
    "keywords": "patrulha movimento",
    "source": "src/scripts/patrol.ts"
  },
  {
    "name": "Pulse",
    "category": "Scripts",
    "description": "Varia a escala periodicamente.",
    "keywords": "pulsar escala",
    "source": "src/scripts/pulse.ts"
  },
  {
    "name": "Spinner",
    "category": "Scripts",
    "description": "Gira o objeto continuamente.",
    "keywords": "girar rotação",
    "source": "src/scripts/spinner.ts"
  },
  {
    "name": "Vagar",
    "category": "Scripts",
    "description": "Anda entre pontos sorteados em volta da posição inicial.",
    "keywords": "vagar aleatorio passear ocioso",
    "source": "src/scripts/vagar.ts"
  },
  {
    "name": "UIButton",
    "category": "UI",
    "description": "Botão na tela do jogo; o clique chega em onUIClick(label) dos scripts do mesmo objeto.",
    "keywords": "ui botao button clique",
    "source": "src/engine/core/ui_button.ts"
  },
  {
    "name": "UIText",
    "category": "UI",
    "description": "Texto na tela do jogo, ancorado a um canto da janela.",
    "keywords": "ui texto hud label",
    "source": "src/engine/core/ui_text.ts"
  },
  {
    "name": "AudioListener",
    "category": "Áudio",
    "description": "O ouvido da cena: o som é ouvido da pose deste objeto. Só um fica ativo por cena.",
    "keywords": "ouvinte listener ouvido escuta som",
    "source": "src/engine/core/audio_listener.ts"
  },
  {
    "name": "AudioSource",
    "category": "Áudio",
    "description": "Toca um clipe (WAV/OGG) ou um tom a partir do objeto, em 2D ou 3D.",
    "keywords": "audio som fonte musica efeito wav ogg beep",
    "source": "src/scripts/audiosource.ts"
  }
];
