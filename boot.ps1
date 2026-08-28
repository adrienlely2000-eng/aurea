$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Root = $PSScriptRoot
$Repo = "adrienlely2000-eng/aurea"
$RevFile = Join-Path $Root "tools\update-rev.txt"

function Read-DotEnvToken {
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path $envFile)) { return "" }
  foreach ($line in Get-Content $envFile -ErrorAction SilentlyContinue) {
    if ($line -match '^\s*GITHUB_TOKEN\s*=\s*(.*)\s*$') {
      return $matches[1].Trim().Trim("'").Trim('"')
    }
  }
  return ""
}

function Get-GitHubHeaders {
  $h = @{ "User-Agent" = "Aurea" }
  $token = Read-DotEnvToken
  if ($token) { $h["Authorization"] = "Bearer $token" }
  return $h
}

function Test-GitDirty {
  if (-not (Test-Path (Join-Path $Root ".git"))) { return $false }
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) { return $false }
  $status = & git -C $Root status --porcelain 2>$null
  return -not [string]::IsNullOrWhiteSpace($status)
}

function Save-Rev([string]$rev) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "tools") | Out-Null
  Set-Content -Path $RevFile -Value $rev -Encoding ASCII
}

function Update-FromZip {
  $zip = Join-Path $env:TEMP "aurea-update.zip"
  $tmp = Join-Path $env:TEMP "aurea-update"
  $url = "https://codeload.github.com/$Repo/zip/refs/heads/main"
  Write-Host "Telechargement de la derniere version..."
  $headers = Get-GitHubHeaders
  Invoke-WebRequest -Uri $url -OutFile $zip -Headers $headers
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $extracted = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (-not $extracted) { throw "Archive GitHub vide" }
  $keep = @(".env", "node_modules", "tools", ".git", ".cursor")
  foreach ($item in Get-ChildItem $extracted.FullName) {
    if ($keep -contains $item.Name) { continue }
    $target = Join-Path $Root $item.Name
    if ($item.PSIsContainer) {
      if (Test-Path $target) { Remove-Item $target -Recurse -Force }
      Copy-Item $item.FullName $target -Recurse -Force
    } else {
      Copy-Item $item.FullName $target -Force
    }
  }
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

function Update-Aurea {
  if ($env:AUREA_SKIP_UPDATE -eq "1") { return }
  if (Test-GitDirty) {
    Write-Host "Modifs locales: pas de mise a jour auto."
    return
  }
  Write-Host "Verification des mises a jour..."
  $headers = Get-GitHubHeaders
  $sha = ""
  try {
    $info = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/main" -Headers $headers
    $sha = [string]$info.sha
  } catch {}
  if ($sha) {
    $current = ""
    if (Test-Path $RevFile) { $current = (Get-Content $RevFile -Raw -ErrorAction SilentlyContinue).Trim() }
    if ($current -and $current -eq $sha) {
      Write-Host "Aurea est a jour."
      return
    }
  }
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git -and (Test-Path (Join-Path $Root ".git"))) {
    try {
      & git -C $Root pull --ff-only origin main
      if ($LASTEXITCODE -eq 0) {
        if ($sha) { Save-Rev $sha }
        Write-Host "Mise a jour OK."
        return
      }
    } catch {}
  }
  try {
    Update-FromZip
    if ($sha) { Save-Rev $sha } else { Save-Rev (Get-Date -Format "yyyyMMddHHmmss") }
    Write-Host "Mise a jour OK."
  } catch {
    Write-Host "Mise a jour impossible pour cette fois, on lance la version actuelle."
  }
}

function Ensure-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    try { & node -v | Out-Null; if ($LASTEXITCODE -eq 0) { return } } catch {}
  }
  $portable = Join-Path $Root "tools\node\node.exe"
  if (Test-Path $portable) {
    $env:Path = "$(Join-Path $Root 'tools\node');$env:Path"
    return
  }
  Write-Host ""
  Write-Host "Node.js n'est pas installe. Telechargement automatique, une seule fois..."
  $getNode = Join-Path $Root "get-node.ps1"
  if (-not (Test-Path $getNode)) { throw "Fichier get-node.ps1 manquant" }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $getNode
  if (-not (Test-Path $portable)) { throw "Impossible d'installer Node.js" }
  $env:Path = "$(Join-Path $Root 'tools\node');$env:Path"
}

function Ensure-Env {
  if (-not (Test-Path (Join-Path $Root ".env"))) {
    throw "Il manque le fichier .env. Copie-le depuis l'ordi ou Aurea marche deja."
  }
}

function Ensure-Modules {
  $marker = Join-Path $Root "node_modules\express"
  if (Test-Path $marker) { return }
  Write-Host "Installation des outils, une seule fois..."
  Push-Location $Root
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install a echoue" }
  } finally {
    Pop-Location
  }
}

Set-Location $Root
try {
  Update-Aurea
  Ensure-Node
  Ensure-Env
  Ensure-Modules
  Write-Host "Lancement d'Aurea..."
  Write-Host "Ne ferme pas cette fenetre tant que tu utilises Aurea."
  Write-Host ""
  & node (Join-Path $Root "server.js")
  Write-Host ""
  Write-Host "Aurea s'est arrete."
} catch {
  Write-Host ""
  Write-Host $_.Exception.Message
  exit 1
}
