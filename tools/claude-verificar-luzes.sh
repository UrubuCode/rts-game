#!/usr/bin/env bash
# Verificação com janela de luzes, céu, câmeras e extensão (Task 11).
# Só pela porta WS (ws://127.0.0.1:7777) e captura por PrintWindow: nenhum
# movimento de mouse ou teclado real.
#
# Pré-requisito: o editor já aberto a partir da raiz do rts-game, com título
# próprio para a captura não pegar outra janela:
#   RTS_TITULO="Engine RTS T11" ui_fixture.exe main.ts
# Uso: bash tools/claude-verificar-luzes.sh [pasta-de-saida]
set -u
cd "$(dirname "$0")/.."
OUT="${1:-build/claude-luzes}"
TITULO="${RTS_TITULO:-Engine RTS T11}"
CAPTURA=".superpowers/sdd/2026-09-26-luzes-ceu-camera-extensao/captura.ps1"
mkdir -p "$OUT"
OUTW="$(cygpath -w "$OUT" 2>/dev/null || echo "$OUT")"

ws() { python tools/ws_client.py "$@" | grep -v '^<-'; }
cap() { sleep 1; powershell -NoProfile -File "$CAPTURA" -Saida "$OUTW/$1.png" -Titulo "$TITULO"; }

# 1. Céu procedural com disco do sol na direção da luz principal.
ws "menu Criar/Luz/Direcional" "ambiente ceu procedural" "luzes"
cap 01a-ceu-procedural
ws "cam 0 3 10 3.665 0.55"   # olha para -forward da luz (yaw 30°, pitch -50° do preset)
cap 01b-sol-disco
# O sol segue a luz: salva, gira a luz no JSON (+0,5 rad em Y) e recarrega.
ws "savescene scratch/claude-t11-sol.json"
python - <<'EOF'
import json
d = json.load(open("scratch/claude-t11-sol.json", encoding="utf-8"))
for o in d["objects"]:
    if o.get("name") == "Luz Direcional": o["rot"][1] += 0.5
json.dump(d, open("scratch/claude-t11-sol2.json", "w", encoding="utf-8"))
EOF
ws "loadscene scratch/claude-t11-sol2.json" "cam 0 3 10 3.665 0.55"
cap 01c-sol-segue-luz
# Neblina e panorama.
ws "cam 0 6 -16 0 -0.15" "ambiente set neblina.densidade 0.06"
cap 01d-neblina
ws "ambiente set neblina.densidade 0" "ambiente ceu panorama assets/textures/claude-panorama-teste.png" "cam 0 3 -12 0 0.1"
cap 01g-panorama

# 2. Três pontuais coloridas, spot e direcional com sombra.
ws "ambiente ceu procedural" "luz add pontual -3 2 -3" "luz add pontual 0 2 -3" "luz add pontual 3 2 -3"
ws "luz 8 set intensidade 0.1" "luz 9 set cor #ff4040" "luz 10 set cor #40ff40" "luz 11 set cor #4040ff" \
   "luz 9 set alcance 6" "luz 10 set alcance 6" "luz 11 set alcance 6" \
   "ambiente set luz.modo cor" "ambiente set luz.intensidade 0.08" "cam 0 10 -14 0 -0.6" "luzes"
cap 02a-tres-pontuais
ws "luz add spot -2 6 4" "luz 12 set angulo 40" "luz 12 set alcance 12" "luz 12 set cor #ffe0a0" "luz 12 set intensidade 2"
cap 02b-spot
ws "luz 8 set sombra 1" "luz 8 set intensidade 1" "select 8"
cap 02c-direcional-sombra-a
ws "savescene scratch/claude-t11-luzes.json"
python - <<'EOF'
import json
d = json.load(open("scratch/claude-t11-luzes.json", encoding="utf-8"))
for o in d["objects"]:
    if o.get("name") == "Luz Direcional": o["rot"] = [-0.6, -0.9, 0]
json.dump(d, open("scratch/claude-t11-luzes2.json", "w", encoding="utf-8"))
EOF
ws "loadscene scratch/claude-t11-luzes2.json" "cam 0 10 -14 0 -0.6" "select 8"
cap 02d-direcional-sombra-b

# 3. Ícones e frustum. Os pixels dos ícones valem para a janela 1200x720 de
# cliente com esta câmera; em outro tamanho, tirar da captura 03c.
ws "camera add" "move 13 -3 4 -8" "select 0"
cap 03c-icones
ws "gizmoat 463 377" "state"    # ícone da pontual #9
ws "select 0" "gizmoat 527 110" "state"   # ícone da spot #12
ws "select 0" "gizmoat 377 477" "state"   # ícone da câmera #13
ws "select 13"
cap 03d-camera-selecionada-frustum

# 4. Menu Criar (itens @menuItem pelo mesmo registro do menu global e do de contexto).
ws "menu" "menu Criar/Luz/Pontual" "luzes"
cap 04-menu-criar-luz-pontual

# 6. Aba Jogo: duas câmeras, proporção, prévia e Alinhar com a vista.
ws "camera add" "cam 10 8 -10 -0.8 -0.45" "camera 15 alinhar" "cam 0 10 -14 0 -0.6" \
   "camera 13 set viewport 0 0 0.5 1" "camera 15 set viewport 0.5 0 0.5 1" "camera 15 set profundidade 1" \
   "gameview jogo" "gameview proporcao 16:9" "cameras"
cap 06a-jogo-tela-dividida-16x9
ws "gameview proporcao 4:3"
cap 06b-jogo-4x3
ws "gameview cena" "select 15" "gameview previa on"
cap 06c-previa-camera

# 7. Play com CameraPrimeiraPessoa na aba Jogo (sem teclas: só confere que roda).
ws "gameview previa off" "addcomp 15 CameraPrimeiraPessoa" "gameview proporcao livre" "play" "gameview jogo"
sleep 2
cap 07-play-fps-aba-jogo
ws "stop" "gameview cena"

# 8. Osso: Skeleton, osso selecionado, ferramenta Girar, pose e Desfazer.
ws "spawn Boneco 0 0 -8 1 1" "addskel 16 assets/models/kenney/character-a.glb"
sleep 2
ws "select 16" "selbone 16 arm-right" "tool rotate" "cam 0 3 -13 0 -0.1"
cap 08a-osso-rotacao-handle
ws "pose 16 arm-right turn z 60"
cap 08b-osso-girado
ws "undo"
cap 08c-osso-desfeito
echo "capturas em $OUT"
