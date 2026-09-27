param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$Saida,
  # "x,y,w,h" em pixels LOGICOS da janela (os do editor); vazio = area cliente inteira
  [string]$Recorte = "",
  # largura logica da janela (W do editor): converte o recorte para pixels fisicos
  [double]$LarguraLogica = 0
)
# Captura SO a janela principal do processo pedido (o proprio editor, pelo PID),
# com PrintWindow: funciona mesmo com a janela coberta por outras e nunca le a
# tela nem outra janela. Usado pelo comando `shot` da porta de controle.
# Saida: "ok <w>x<h>" (codigo 0) ou o motivo (codigo != 0).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class JanelaRts {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
# PW_CLIENTONLY (1) | PW_RENDERFULLCONTENT (2): so a area cliente, inclusive o que a GPU desenha
$PW_CLIENTE_GPU = 3
try { $p = Get-Process -Id $ProcessId } catch { Write-Output "processo $ProcessId nao encontrado"; exit 1 }
if ($p.MainWindowHandle -eq [IntPtr]::Zero) { Write-Output "processo $ProcessId sem janela principal"; exit 1 }
if (-not $p.Responding) { Write-Output "janela '$($p.MainWindowTitle)' nao esta respondendo; sem captura"; exit 2 }
$r = New-Object JanelaRts+RECT
[JanelaRts]::GetClientRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { Write-Output "janela minimizada ou sem area cliente"; exit 3 }
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
$ok = [JanelaRts]::PrintWindow($p.MainWindowHandle, $dc, $PW_CLIENTE_GPU)
$g.ReleaseHdc($dc); $g.Dispose()
if (-not $ok) { $bmp.Dispose(); Write-Output "PrintWindow falhou"; exit 3 }
$final = $bmp
if ($Recorte.Length -gt 0) {
  $v = $Recorte.Split(",") | ForEach-Object { [double]$_ }
  $escala = if ($LarguraLogica -gt 0) { $w / $LarguraLogica } else { 1.0 }
  $rx = [Math]::Max(0, [int][Math]::Round($v[0] * $escala)); $ry = [Math]::Max(0, [int][Math]::Round($v[1] * $escala))
  $rw = [Math]::Min($w - $rx, [int][Math]::Round($v[2] * $escala)); $rh = [Math]::Min($h - $ry, [int][Math]::Round($v[3] * $escala))
  if ($rw -le 0 -or $rh -le 0) { $bmp.Dispose(); Write-Output "recorte fora da janela"; exit 4 }
  $final = $bmp.Clone((New-Object System.Drawing.Rectangle $rx, $ry, $rw, $rh), $bmp.PixelFormat)
  $bmp.Dispose()
}
$pasta = Split-Path -Parent $Saida
if ($pasta.Length -gt 0 -and -not (Test-Path -LiteralPath $pasta)) { New-Item -ItemType Directory -Force -Path $pasta | Out-Null }
$final.Save($Saida, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "ok $($final.Width)x$($final.Height)"
$final.Dispose()
exit 0
