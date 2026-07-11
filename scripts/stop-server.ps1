# stop-server.ps1
# Stops the Shipwright WebUI Hono server — whether it was started in
# production mode (start-server-production.cmd) or dev mode (tsx watch).
# Kills the port listener plus any `tsx` process on the server entry.
# Honors $env:PORT (default 3847) — the .ps1 parallel of stop-server.sh's
# PORT="${PORT:-3847}", so an operator on a custom PORT stops the right server.
# The `^\d{1,5}$` guard degrades an unset/blank/non-numeric PORT to the 3847
# default instead of throwing on the [int] cast (a bare `[int]$env:PORT` would
# crash on PORT="abc"). Capping at 5 digits (<=99999) also keeps the cast below
# Int32.MaxValue, so a huge numeric PORT degrades to the default rather than
# throwing an overflow — matching the .sh twin's non-crashing behavior.
$Port = if ($env:PORT -match '^\d{1,5}$') { [int]$env:PORT } else { 3847 }
Write-Host ''
Write-Host 'Stopping Shipwright WebUI Hono...' -ForegroundColor Yellow
$killed = New-Object System.Collections.Generic.List[int]
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { $killed.Add([int]$_); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match 'tsx') -and ($_.CommandLine -match 'src[\\/]index\.ts') } |
  ForEach-Object { $killed.Add([int]$_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$ids = ($killed | Sort-Object -Unique) -join ' '
if ($ids) { Write-Host "  stopped PID(s): $ids" -ForegroundColor Green }
else { Write-Host "  nothing was running on port $Port." -ForegroundColor DarkGray }
Write-Host ''
Start-Sleep -Seconds 2
