$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ver = "22.18.0"
$arch = "x64"
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $arch = "arm64" }
if ($env:PROCESSOR_ARCHITECTURE -eq "x86" -and -not $env:PROCESSOR_ARCHITEW6432) { $arch = "x86" }

$folder = "node-v$ver-win-$arch"
$url = "https://nodejs.org/dist/v$ver/$folder.zip"
$zip = Join-Path $env:TEMP "aurea-node.zip"
$tmp = Join-Path $env:TEMP "aurea-node"
$dest = Join-Path $PSScriptRoot "tools\node"

Write-Host "Telechargement de Node.js $ver..."
Invoke-WebRequest -Uri $url -OutFile $zip
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force

$extracted = Join-Path $tmp $folder
if (-not (Test-Path (Join-Path $extracted "node.exe"))) {
  throw "Archive Node incomplete"
}

New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "tools") | Out-Null
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Move-Item $extracted $dest
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Node.js est pret."
