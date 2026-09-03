# Generates public/og.png — a simple branded placeholder for social sharing
# (1200x630, matching the site's "Editorial brief" palette).
# Replace with a designed asset before launch; keep this script for regeneration.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/gen-og.ps1

Add-Type -AssemblyName System.Drawing

$w = 1200
$h = 630
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$paper = [System.Drawing.Color]::FromArgb(245, 240, 230)
$ink = [System.Drawing.Color]::FromArgb(28, 25, 23)
$amber = [System.Drawing.Color]::FromArgb(180, 83, 9)

$g.Clear($paper)

# Double rule border, like the site's .rule-double
$outer = New-Object System.Drawing.Pen($ink, 3)
$g.DrawRectangle($outer, 40, 40, $w - 80, $h - 80)
$inner = New-Object System.Drawing.Pen($ink, 1)
$g.DrawRectangle($inner, 54, 54, $w - 108, $h - 108)

$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center
$center.LineAlignment = [System.Drawing.StringAlignment]::Center

$wordmark = New-Object System.Drawing.Font("Georgia", 92, [System.Drawing.FontStyle]::Regular)
$inkBrush = New-Object System.Drawing.SolidBrush($ink)
$g.DrawString(
  "Localscope.",
  $wordmark,
  $inkBrush,
  (New-Object System.Drawing.RectangleF(0, 150, $w, 130)),
  $center
)

$tagline = New-Object System.Drawing.Font("Segoe UI", 30, [System.Drawing.FontStyle]::Regular)
$amberBrush = New-Object System.Drawing.SolidBrush($amber)
$g.DrawString(
  "Weekly market briefs for salons & spas",
  $tagline,
  $amberBrush,
  (New-Object System.Drawing.RectangleF(0, 310, $w, 60)),
  $center
)

$out = Join-Path $PSScriptRoot "..\public\og.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
Write-Output "Wrote $out"