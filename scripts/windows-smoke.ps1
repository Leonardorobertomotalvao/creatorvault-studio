$ErrorActionPreference='Stop'
$Version=(Get-Content package.json -Raw | ConvertFrom-Json).version
$Stage=Join-Path $PSScriptRoot ('..\dist\CreatorVault_Studio_v'+$Version+'_Windows_x64')
$Exe=Join-Path $Stage 'CreatorVaultStudio.exe'
$env:CV_NO_BROWSER='1'
$Process=Start-Process -FilePath $Exe -WorkingDirectory $Stage -PassThru
try {
  $SessionFile=Join-Path $Stage 'logs\app-session.json'
  $Session=$null
  for ($Attempt=0;$Attempt -lt 80;$Attempt++) {
    if (Test-Path -LiteralPath $SessionFile) { $Session=Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json; break }
    if ($Process.HasExited) { throw 'Launcher encerrou antes de iniciar.' }
    Start-Sleep -Milliseconds 250
  }
  if (-not $Session) { throw 'Launcher nao iniciou em 20 segundos.' }
  $Health=Invoke-RestMethod -Uri ($Session.url+'/api/health')
  if ($Health.app -ne 'creatorvault-studio' -or $Health.version -ne $Version) { throw 'Servico local incorreto.' }
  Invoke-RestMethod -Method Post -Uri ($Session.url+'/api/shutdown') -ContentType 'application/json' -Body '{}' | Out-Null
  if (-not $Process.WaitForExit(10000)) { throw 'Launcher nao encerrou.' }
  if ($Process.ExitCode -ne 0) { throw 'Launcher encerrou com erro.' }
  Write-Output 'Executavel Windows iniciou e encerrou corretamente.'
} finally {
  if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
}
