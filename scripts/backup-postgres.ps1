$ErrorActionPreference = "Stop"
$backupDir = Join-Path $PSScriptRoot "..\backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$file = Join-Path $backupDir "sibir_optika_$stamp.sql"
if (-not $env:DATABASE_URL) {
  Write-Host "DATABASE_URL не задан. Укажите его в .env или переменных окружения."
  exit 1
}
pg_dump $env:DATABASE_URL -f $file
Write-Host "Резервная копия создана: $file"
