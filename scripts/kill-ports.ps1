# Kill processes occupying specified ports
$ports = @(3000, 3411, 8100, 5100, 3210)
foreach ($p in $ports) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      Write-Host "  Port $p PID $($c.OwningProcess) killed"
    }
  } catch {
    # ignore
  }
}
