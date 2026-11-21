# make-icons.ps1 — 用同一张美术统一所有图标（业主 2026-11-21）
#
# 源图：launcher\logo.jpg（= Downloads\9626A8DAC91288EB03652558BABFC599.jpg，1200×1188，SHA256 相同）
# 产出：
#   launcher\game.ico            16/24/32/48/64/128/256（快捷方式用，标准 DIB 条目）
#   launcher\app.ico             同上（启动器自带图标位，替换掉原来的灰白标记）
#   public\icons\favicon.ico     16/32/48（浏览器标签，标准 DIB）
#   public\icons\favicon-16/32/48.png
#   public\icons\apple-touch-icon.png   180（iOS 主屏）
#   public\icons\app-192/512.png        PWA any
#   public\icons\app-maskable-192/512.png  PWA maskable（美术缩到 80% 安全区，底 #0c0f0e）
#   public\icons\app.svg         内嵌 512 PNG（base64），保持 sizes="any" 的引用不断
#
# 用法：powershell -ExecutionPolicy Bypass -File make-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcPath = Join-Path $root 'launcher\logo.jpg'
if (-not (Test-Path -LiteralPath $srcPath)) { throw "找不到源图：$srcPath" }

$src = New-Object System.Drawing.Bitmap($srcPath)
$side = [Math]::Min($src.Width, $src.Height)
$ox = [int](($src.Width - $side) / 2)
$oy = [int](($src.Height - $side) / 2)
$srcRect = New-Object System.Drawing.Rectangle($ox, $oy, $side, $side)
Write-Host "源图 $($src.Width)x$($src.Height) -> 裁 $side x $side"

function New-Scaled([int]$size, [double]$inset) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Black)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  if ($inset -le 0) {
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0,0,$size,$size)), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  } else {
    # maskable：底色铺满，美术缩进安全区
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#0c0f0e'))
    $inner = [int][Math]::Round($size * (1 - 2 * $inset))
    $off = [int](($size - $inner) / 2)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle($off,$off,$inner,$inner)), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  }
  $g.Dispose()
  return $bmp
}

# 标准 ICO（DIB 条目，Explorer / GDI+ 都能读）
function Write-Ico([string]$path, [int[]]$sizes) {
  $entries = @()
  foreach ($s in $sizes) {
    $bmp = New-Scaled $s 0
    $xor = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter($xor)
    for ($y = $s - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $s; $x++) { $c = $bmp.GetPixel($x,$y); $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]255) }
    }
    $xorBytes = $xor.ToArray(); $bw.Close(); $xor.Close()
    $maskRow = [int][Math]::Ceiling($s / 32.0) * 4
    $mask = New-Object byte[] ($maskRow * $s)
    $hdr = New-Object System.IO.MemoryStream; $bw2 = New-Object System.IO.BinaryWriter($hdr)
    $bw2.Write([UInt32]40); $bw2.Write([Int32]$s); $bw2.Write([Int32]($s*2))
    $bw2.Write([UInt16]1); $bw2.Write([UInt16]32); $bw2.Write([UInt32]0)
    $bw2.Write([UInt32]($xorBytes.Length + $mask.Length))
    $bw2.Write([Int32]0); $bw2.Write([Int32]0); $bw2.Write([UInt32]0); $bw2.Write([UInt32]0)
    $hdrBytes = $hdr.ToArray(); $bw2.Close(); $hdr.Close()
    $data = New-Object byte[] ($hdrBytes.Length + $xorBytes.Length + $mask.Length)
    [Array]::Copy($hdrBytes, 0, $data, 0, $hdrBytes.Length)
    [Array]::Copy($xorBytes, 0, $data, $hdrBytes.Length, $xorBytes.Length)
    $entries += ,@($s, $data)
    $bmp.Dispose()
  }
  $fs = [System.IO.File]::Create($path); $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$entries.Count)
  $offset = 6 + 16 * $entries.Count
  foreach ($e in $entries) {
    $s = $e[0]; $len = $e[1].Length
    $bw.Write([byte]$(if ($s -ge 256) {0} else {$s}))
    $bw.Write([byte]$(if ($s -ge 256) {0} else {$s}))
    $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset); $offset += $len
  }
  foreach ($e in $entries) { $bw.Write($e[1]) }
  $bw.Flush(); $bw.Close(); $fs.Close()
  Write-Host ("  [ico] {0}  {1} 尺寸  {2} KB" -f (Split-Path -Leaf $path), $sizes.Count, [math]::Round((Get-Item -LiteralPath $path).Length/1KB,1))
}

function Write-Png([string]$path, [int]$size, [double]$inset = 0) {
  $bmp = New-Scaled $size $inset
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("  [png] {0,-26} {1}x{1}  {2} KB" -f (Split-Path -Leaf $path), $size, [math]::Round((Get-Item -LiteralPath $path).Length/1KB,1))
}

$icons = Join-Path $root 'public\icons'

# 启动器/快捷方式的两份 ico
Write-Ico (Join-Path $root 'launcher\game.ico') @(16,24,32,48,64,128,256)
Write-Ico (Join-Path $root 'launcher\app.ico')  @(16,24,32,48,64,128,256)

# 浏览器标签 / PWA
Write-Ico (Join-Path $icons 'favicon.ico') @(16,32,48)
foreach ($s in 16,32,48) { Write-Png (Join-Path $icons "favicon-$s.png") $s }
Write-Png (Join-Path $icons 'apple-touch-icon.png') 180
Write-Png (Join-Path $icons 'app-192.png') 192
Write-Png (Join-Path $icons 'app-512.png') 512
Write-Png (Join-Path $icons 'app-maskable-192.png') 192 0.1
Write-Png (Join-Path $icons 'app-maskable-512.png') 512 0.1

# app.svg：把 512 PNG 内嵌成 base64，保持 index.html 里 sizes="any" 的引用继续可用
$pngBytes = [System.IO.File]::ReadAllBytes((Join-Path $icons 'app-512.png'))
$b64 = [Convert]::ToBase64String($pngBytes)
$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <image width="512" height="512" href="data:image/png;base64,$b64"/>
</svg>
"@
[System.IO.File]::WriteAllText((Join-Path $icons 'app.svg'), $svg, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("  [svg] app.svg  内嵌 512 PNG  {0} KB" -f [math]::Round((Get-Item (Join-Path $icons 'app.svg')).Length/1KB,1))

$src.Dispose()
Write-Host ''
Write-Host '  全部图标已由 launcher\logo.jpg 统一生成。'
