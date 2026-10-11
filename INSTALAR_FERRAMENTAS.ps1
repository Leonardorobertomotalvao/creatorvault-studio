param([switch]$NonInteractive)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = $PSScriptRoot
$Tools = Join-Path $Root 'tools'
$TempDir = Join-Path $Root ('setup_temp\' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Tools, $TempDir | Out-Null
$Backups = @{}
$Committed = New-Object System.Collections.Generic.List[string]
function Fetch([string]$Uri, [string]$Destination) {
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination -TimeoutSec 180 -Headers @{'User-Agent'='CreatorVault-Studio/1.6'}
}
function Verify-Hash([string]$File, [string]$Hash) {
  if ($Hash -notmatch '^[0-9a-fA-F]{64}$') { throw 'Checksum oficial invalido.' }
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Hash) { throw ('Checksum divergente: ' + (Split-Path $File -Leaf)) }
}
try {
  Write-Output '[1/3] Consultando a versao oficial do yt-dlp...'
  $Release = Invoke-RestMethod -Uri 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' -Headers @{'User-Agent'='CreatorVault-Studio/1.6'} -TimeoutSec 60
  $Asset = $Release.assets | Where-Object { $_.name -eq 'yt-dlp.exe' } | Select-Object -First 1
  $SumsAsset = $Release.assets | Where-Object { $_.name -eq 'SHA2-256SUMS' } | Select-Object -First 1
  if (-not $Asset -or -not $SumsAsset) { throw 'Release oficial sem executavel ou checksums.' }
  $NewYt = Join-Path $TempDir 'yt-dlp.exe'
  $Sums = Join-Path $TempDir 'SHA2-256SUMS'
  Fetch $Asset.browser_download_url $NewYt
  Fetch $SumsAsset.browser_download_url $Sums
  $Line = Get-Content -LiteralPath $Sums | Where-Object { $_ -match '^([0-9a-fA-F]{64})\s+\*?yt-dlp\.exe\s*$' } | Select-Object -First 1
  if (-not $Line) { throw 'Checksum do yt-dlp nao encontrado.' }
  Verify-Hash $NewYt ([regex]::Match($Line,'^[0-9a-fA-F]{64}').Value)
  & $NewYt --version
  if ($LASTEXITCODE -ne 0) { throw 'O executavel do yt-dlp nao passou na verificacao.' }
  $Install = @{'yt-dlp.exe'=$NewYt}
  Write-Output '[2/3] Verificando FFmpeg e FFprobe...'
  $NeedFF = $false
  foreach ($Name in @('ffmpeg.exe','ffprobe.exe')) {
    $Existing = Join-Path $Tools $Name
    if (-not (Test-Path -LiteralPath $Existing)) { $NeedFF = $true; continue }
    $VersionOutput = & $Existing -version
    if ($VersionOutput) { Write-Output $VersionOutput[0] }
    if ($LASTEXITCODE -ne 0) { $NeedFF = $true }
  }
  if ($NeedFF) {
    Write-Output 'Baixando FFmpeg Essentials da gyan.dev (aproximadamente 110 MB)...'
    $Zip = Join-Path $TempDir 'ffmpeg.zip'
    $HashFile = Join-Path $TempDir 'ffmpeg.sha256'
    Fetch 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256' $HashFile
    Fetch 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' $Zip
    Verify-Hash $Zip ([regex]::Match((Get-Content -LiteralPath $HashFile -Raw),'[0-9a-fA-F]{64}').Value)
    $Unpacked = Join-Path $TempDir 'ffmpeg_unpack'
    Expand-Archive -LiteralPath $Zip -DestinationPath $Unpacked
    $Bin = Get-ChildItem -LiteralPath $Unpacked -Filter 'ffmpeg.exe' -Recurse -File | Select-Object -First 1
    if (-not $Bin) { throw 'ffmpeg.exe nao localizado no pacote.' }
    foreach ($Name in @('ffmpeg.exe','ffprobe.exe')) {
      $File = Join-Path $Bin.DirectoryName $Name
      if (-not (Test-Path -LiteralPath $File)) { throw ('Arquivo ausente: '+$Name) }
      $VersionOutput = & $File -version
      if ($VersionOutput) { Write-Output $VersionOutput[0] }
      if ($LASTEXITCODE -ne 0) { throw ('Falha ao validar '+$Name) }
      $Install[$Name]=$File
    }
    $Info = Join-Path $Tools 'ffmpeg-info'
    New-Item -ItemType Directory -Force -Path $Info | Out-Null
    foreach ($Name in @('LICENSE','README.txt')) {
      $File = Join-Path (Split-Path $Bin.DirectoryName -Parent) $Name
      if (Test-Path -LiteralPath $File) { Copy-Item -LiteralPath $File -Destination (Join-Path $Info $Name) -Force }
    }
  } else { Write-Output 'FFmpeg e FFprobe existentes foram validados.' }
  Write-Output '[3/3] Instalando os arquivos verificados...'
  foreach ($Name in $Install.Keys) {
    $Target = Join-Path $Tools $Name
    if (Test-Path -LiteralPath $Target) {
      $Backup = Join-Path $TempDir ($Name+'.backup')
      Copy-Item -LiteralPath $Target -Destination $Backup
      $Backups[$Name]=$Backup
    }
    $Committed.Add($Name)
    Copy-Item -LiteralPath $Install[$Name] -Destination $Target -Force
  }
  Write-Output 'Ferramentas prontas. Volte ao painel para baixar ou recortar.'
} catch {
  foreach ($Name in $Committed) {
    $Target = Join-Path $Tools $Name
    if ($Backups.ContainsKey($Name)) { Copy-Item -LiteralPath $Backups[$Name] -Destination $Target -Force -ErrorAction SilentlyContinue }
    else { Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue }
  }
  Write-Output ('Falha na instalacao: '+$_.Exception.Message)
  Write-Output 'Os executaveis anteriores foram preservados. Confira a internet e o espaco em disco.'
  exit 1
} finally {
  Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
