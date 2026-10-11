$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$Alvo = Join-Path $Raiz 'CreatorVaultStudio.exe'
if (-not (Test-Path -LiteralPath $Alvo)) { throw "Executavel nao encontrado: $Alvo" }
$Desktop = [Environment]::GetFolderPath('Desktop')
$Local = Join-Path $Desktop 'CreatorVault Studio.lnk'
$Shell = New-Object -ComObject WScript.Shell
$Atalho = $Shell.CreateShortcut($Local)
$Atalho.TargetPath = $Alvo
$Atalho.WorkingDirectory = $Raiz
$Atalho.Description = 'CreatorVault Studio 1.6 - Biblioteca local e downloads autorizados'
$Atalho.IconLocation = "$Alvo,0"
$Atalho.Save()
Write-Host "Atalho criado: $Local" -ForegroundColor Green
