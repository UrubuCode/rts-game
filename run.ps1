# Sobe o editor. Um comando, com os dois parâmetros que ele SEMPRE precisa.
#
#   .\run.ps1                            a cena padrão
#   .\run.ps1 scenes/meshcollider.json   uma cena específica
#   .\run.ps1 -SemBuild                  pula a compilação, usa o binário que existe
#
# ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
#
# Rodar o editor precisa de duas coisas que não são óbvias, e esquecer qualquer
# uma delas dá um erro que não diz o que fazer:
#
#   --features ui    o jogo importa `rts:egui` e `rts:gpu`, que vivem no crate
#                    `rts-ui`, atrás dessa feature. Sem ela o programa morre no
#                    primeiro import com "nothing registered that specifier".
#
#   ui_fixture       e NÃO `rts run`. O `rts run` compila e executa numa thread
#                    SECUNDÁRIA, e o winit entra em pânico ao criar o event loop
#                    fora da principal — "Initializing the event loop outside of
#                    the main thread is a significant cross-platform
#                    compatibility hazard". O `ui_fixture` roda um arquivo `.ts`
#                    com a UI instalada, na thread principal, que é a única onde
#                    uma janela pode existir.
#
# ── POR QUE `ui` NÃO É FEATURE PADRÃO, já que sempre é preciso AQUI ────────
#
# Porque "aqui" não é todo lugar. A regra 1 do `crates/rts-core/README.md` diz
# que DISPONIBILIDADE é o que decide pertencimento, e é a única coisa que decide:
# `rts-ui` traz `wgpu` e `winit`, que não existem em wasm, nem num container de
# CI sem display, nem num servidor headless.
#
# Tornar `ui` padrão faria a suíte inteira, o `run_fixture` e o cross-runtime
# linkarem uma janela que nunca vão abrir. É a mesma regra que faz `physics` SER
# padrão — `rayon` roda em toda máquina que roda o motor, e uma janela não.
#
# Então o parâmetro fica, e o que some é a necessidade de lembrar dele.

param(
    [string]$Cena = "",
    [switch]$SemBuild
)

$ErrorActionPreference = "Stop"

# O motor mora fora deste repositório, e o caminho é fixo por enquanto. Se ele
# mudar, muda aqui e em nenhum outro lugar — que é metade do motivo deste script.
$Motor = "E:\rts"
$Exe = Join-Path $Motor "target\release\examples\ui_fixture.exe"

if (-not $SemBuild) {
    Write-Host "[run] compilando o editor (release, --features ui)..." -ForegroundColor DarkGray
    Push-Location $Motor
    try {
        cargo build --release -p rts-host --example ui_fixture --features ui
        # `cargo` sinaliza falha pelo código de saída, e sem esta checagem o
        # script seguiria para rodar um binário velho — que é a armadilha de
        # medir com o executável de outro commit.
        if ($LASTEXITCODE -ne 0) { throw "a compilacao falhou" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $Exe)) {
    throw "nao existe $Exe — rode sem -SemBuild para compilar"
}

if ($Cena -ne "") {
    # RTS_SCENE tem prioridade sobre a cena salva, e existe para uma
    # demonstração poder ser aberta sem sobrescrever `assets/scene.json`, que é
    # a cena de trabalho de quem estiver usando o editor.
    $env:RTS_SCENE = $Cena
    Write-Host "[run] cena: $Cena" -ForegroundColor DarkGray
}

& $Exe main.ts
