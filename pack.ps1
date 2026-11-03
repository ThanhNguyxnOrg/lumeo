param(
  [string]$OutDir = $HOME,
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not $Version) {
  $manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
  $Version = $manifest.version
}
$Version = $Version.TrimStart("v")
$out = Join-Path $OutDir "lumeo-v$Version.zip"

node scripts/build-targets.mjs --targets chrome --out dist --version $Version

if (Test-Path $out) {
  Remove-Item $out -Force
}
Copy-Item "dist/lumeo-v$Version-chrome.zip" $out -Force

$item = Get-Item $out
$size = "{0:N1} MB" -f ($item.Length / 1MB)
Write-Host "Packed $out ($size)"
