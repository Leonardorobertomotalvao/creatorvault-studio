param([switch]$SkipTests)
$ErrorActionPreference='Stop'
$Root=$PSScriptRoot
Set-Location -LiteralPath $Root
if (-not $SkipTests) {
  $Tests = @(Get-ChildItem -LiteralPath (Join-Path $Root 'tests') -Filter '*.test.mjs' -File | ForEach-Object {$_.FullName})
  & node --test @Tests
  if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }
}
$Version=(Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
$Dist=Join-Path $Root 'dist'
$Name='CreatorVault_Studio_v'+$Version+'_Windows_x64'
$Stage=Join-Path $Dist $Name
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage,(Join-Path $Stage 'runtime'),(Join-Path $Stage 'tools') | Out-Null
$env:GOOS='windows';$env:GOARCH='amd64';$env:CGO_ENABLED='0'
& go build -buildvcs=false -trimpath '-ldflags=-H windowsgui -s -w' -o (Join-Path $Stage 'CreatorVaultStudio.exe') ./launcher
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o executavel.' }
foreach ($File in @('server.mjs','package.json','README.md','CHANGELOG.md','LICENSE','THIRD_PARTY_NOTICES.md','RELEASE_NOTES.md','go.mod','build.ps1','INSTALAR_FERRAMENTAS.ps1','INSTALAR_FERRAMENTAS.bat','INICIAR_CREATORVAULT.bat','CRIAR_ATALHO.ps1','CRIAR_ATALHO.bat')) {
  Copy-Item -LiteralPath (Join-Path $Root $File) -Destination (Join-Path $Stage $File)
}
foreach ($Directory in @('lib','public','launcher','tests','scripts','.github')) { Copy-Item -LiteralPath (Join-Path $Root $Directory) -Destination $Stage -Recurse }
Copy-Item -LiteralPath (Join-Path $Root 'tools\LEIA-ME.txt') -Destination (Join-Path $Stage 'tools\LEIA-ME.txt')
$NodeVersion='24.21.0'
$NodeHash='158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$Cache=Join-Path $Root '.cache-build'
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$Archive=Join-Path $Cache ('node-v'+$NodeVersion+'-win-x64.zip')
if (-not (Test-Path -LiteralPath $Archive) -or (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $NodeHash) {
  Invoke-WebRequest -Uri ('https://nodejs.org/dist/v'+$NodeVersion+'/node-v'+$NodeVersion+'-win-x64.zip') -OutFile $Archive -TimeoutSec 180
}
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $NodeHash) { throw 'Checksum oficial do Node.js divergente.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
  foreach ($File in @('node.exe','LICENSE')) {
    $Entry=$Zip.Entries | Where-Object { $_.FullName -eq ('node-v'+$NodeVersion+'-win-x64/'+$File) } | Select-Object -First 1
    if (-not $Entry) { throw ('Runtime incompleto: '+$File) }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($Entry,(Join-Path $Stage ('runtime\'+$File)),$true)
  }
} finally { $Zip.Dispose() }
$Output=Join-Path $Dist ($Name+'.zip')
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($Stage,$Output,[IO.Compression.CompressionLevel]::Optimal,$true)
$Sum=(Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $Dist 'SHA256SUMS.txt') -Value ($Sum+'  '+$Name+'.zip') -Encoding ascii
Write-Output ('Pacote pronto: '+$Output)
