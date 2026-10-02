param(
    [switch]$Build,
    [switch]$Release,
    [int]$Frames = 0,
    [string]$Capture = '',
    [int]$Seed = 42,
    [ValidateSet('heightfield', 'voxel')]
    [string]$Generator = 'heightfield',
    [string]$RuntimePath = '',
    [string]$TargetPath = '',
    [ValidateSet('sailing', 'water_spline', 'water', 'courtyard', 'city', 'terrain', 'loading', 'loading_preview', 'infinite', 'world_component')]
    [string]$Scene = 'courtyard'
)
$ErrorActionPreference = 'Stop'
$pbrRoot = $PSScriptRoot
$pbrRuntime = Join-Path $pbrRoot 'build/rts-pbr'
$pbrTarget = Join-Path $pbrRoot 'build/pbr-target'
if ($RuntimePath) { $pbrRuntime = [System.IO.Path]::GetFullPath($RuntimePath) }
if ($TargetPath) { $pbrTarget = [System.IO.Path]::GetFullPath($TargetPath) }
if (!(Test-Path -LiteralPath (Join-Path $pbrRuntime 'Cargo.toml'))) {
    throw 'Runtime PBR ausente. Veja docs/render-pbr.md para preparar o checkout e aplicar o patch.'
}
if ($Build) {
    Push-Location $pbrRuntime
    try {
        $pbrArgs = @('build', '-p', 'rts-host', '--example', 'ui_fixture', '--locked', '--target-dir', $pbrTarget)
        if ($Release) { $pbrArgs += '--release' }
        & cargo @pbrArgs
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar runtime PBR.' }
    } finally { Pop-Location }
}
$pbrProfile = if ($Release) { 'release' } else { 'debug' }
$pbrExe = Join-Path $pbrTarget "$pbrProfile/examples/ui_fixture.exe"
if (!(Test-Path -LiteralPath $pbrExe)) { throw 'Binário ausente. Rode novamente com -Build.' }
$pbrOldFrames = $env:RTS_PBR_FRAMES
$pbrOldCapture = $env:RTS_PBR_CAPTURE
$pbrOldSeed = $env:RTS_CITY_SEED
$pbrOldGenerator = $env:RTS_WORLD_GENERATOR
Push-Location $pbrRoot
try {
    $env:RTS_PBR_FRAMES = [string]$Frames
    $env:RTS_PBR_CAPTURE = $Capture
    $env:RTS_CITY_SEED = [string]$Seed
    $env:RTS_WORLD_GENERATOR = $Generator
    & $pbrExe "examples/pbr_$Scene.ts"
    if ($LASTEXITCODE -ne 0) { throw 'A cena PBR terminou com erro.' }
} finally {
    $env:RTS_PBR_FRAMES = $pbrOldFrames
    $env:RTS_PBR_CAPTURE = $pbrOldCapture
    $env:RTS_CITY_SEED = $pbrOldSeed
    $env:RTS_WORLD_GENERATOR = $pbrOldGenerator
    Pop-Location
}
