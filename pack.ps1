param(
  [string]$OutDir = $HOME
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version
$out = Join-Path $OutDir "lumeo-v$version.zip"

if (Test-Path $out) {
  Remove-Item $out -Force
}

$excludeNames = @(
  ".git",
  "node_modules",
  "_design_reference",
  "_echoly_extracted",
  "ext",
  "output",
  ".vscode",
  ".idea",
  ".DS_Store",
  "Thumbs.db"
)

$excludeFiles = @(
  "pack.sh",
  "pack.ps1",
  "release.sh"
)

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("lumeo-pack-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null

try {
  Get-ChildItem -Force | ForEach-Object {
    if ($excludeNames -contains $_.Name) { return }
    if ($excludeFiles -contains $_.Name) { return }
    if ($_.Extension -eq ".zip") { return }
    Copy-Item $_.FullName -Destination $temp -Recurse -Force
  }

  Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $out -Force
  $itemCount = (Get-ChildItem -Recurse -File $temp | Measure-Object).Count
  $size = "{0:N1} MB" -f ((Get-Item $out).Length / 1MB)
  Write-Host "Packed $out ($size, $itemCount files)"
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
