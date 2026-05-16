# stop-server.ps1
# Stops the Shipwright WebUI Hono server — whether it was started in
# production mode (start-server-production.cmd) or dev mode (tsx watch).
# Kills the port-3847 listener plus any `tsx` process on the server entry.
Write-Host ''
Write-Host 'Stopping Shipwright WebUI Hono...' -ForegroundColor Yellow
$killed = New-Object System.Collections.Generic.List[int]
Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { $killed.Add([int]$_); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match 'tsx') -and ($_.CommandLine -match 'src[\\/]index\.ts') } |
  ForEach-Object { $killed.Add([int]$_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$ids = ($killed | Sort-Object -Unique) -join ' '
if ($ids) { Write-Host "  stopped PID(s): $ids" -ForegroundColor Green }
else { Write-Host '  nothing was running on port 3847.' -ForegroundColor DarkGray }
Write-Host ''
Start-Sleep -Seconds 2
