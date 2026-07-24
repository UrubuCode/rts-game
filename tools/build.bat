@echo off
REM BUILD DO JOGO
REM Compila game.ts (o RUNTIME, nao o editor) num .exe nativo e monta a pasta
REM distribuivel em build\ com os assets que o jogo le em tempo de execucao.
REM
REM Chamado pelo botao "Build" do editor (main.ts) e usavel na mao:
REM     tools\build.bat            -^> build\RTSGame.exe
REM     tools\build.bat MeuJogo    -^> build\MeuJogo.exe
REM
REM Sem acentos/box-drawing de proposito: o cmd.exe interpreta bytes altos em
REM REM como comando e o build falha.
setlocal
cd /d "%~dp0.."

set NOME=%1
if "%NOME%"=="" set NOME=RTSGame

echo [build] compilando game.ts em build\%NOME%.exe
if not exist build mkdir build
.\rts.exe compile game.ts build\%NOME%.exe
if errorlevel 1 (
  echo [build] FALHOU na compilacao
  pause
  exit /b 1
)

REM o .obj e intermediario do linker: nao vai na distribuicao
if exist build\%NOME%.obj del /q build\%NOME%.obj

REM Assets: o .exe le a cena e os modelos/texturas do DISCO em runtime, entao
REM eles precisam viajar junto do executavel. `scenes\` e obrigatorio: sem ele o
REM jogo abre com 0 objetos, porque assets\scene.json (a cena do usuario) nao
REM existe num checkout limpo.
echo [build] copiando assets
if not exist build\assets mkdir build\assets
xcopy /E /I /Y /Q assets build\assets >nul
if exist scenes (
  if not exist build\scenes mkdir build\scenes
  xcopy /E /I /Y /Q scenes build\scenes >nul
)

echo [build] OK: build\%NOME%.exe
echo [build] rode: cd build ^&^& %NOME%.exe
endlocal
