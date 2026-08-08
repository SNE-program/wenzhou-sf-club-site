# ============================================
# push-retry.ps1 - auto-retry git push (network tolerant)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/push-retry.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/push-retry.ps1 -Rounds 6 -DelaySec 10
# Strategy:
#   - Try "direct connect to each GitHub IP" then "via local proxy 127.0.0.1:7890"
#   - If all fail in a round, wait DelaySec and retry (up to Rounds)
#   - If push is rejected (need pull --rebase), stop and hint (not a network issue)
# ============================================
param(
  [int]$Rounds = 8,
  [int]$DelaySec = 12,
  [string]$Proxy = "http://127.0.0.1:7890"
)

$ips = @("140.82.112.4", "140.82.113.4", "140.82.114.4", "140.82.121.4", "140.82.112.3")

function Invoke-GitPush([string]$label, [string]$ip, [string]$proxy) {
  $args = @("push", "origin", "main")
  if ($proxy) {
    $args = @("-c", "http.proxy=$proxy", "-c", "https.proxy=$proxy") + $args
  } else {
    $args = @("-c", "http.proxy=", "-c", "https.proxy=") + $args
  }
  $args = @("-c", "http.curloptResolve=github.com:443:$ip") + $args
  Write-Host "  [$label] git $($args -join ' ')"
  $out = & git @args 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    $joined = ($out | Out-String)
    if ($joined -match "rejected|non-fast-forward|fetch first|have to pull") {
      Write-Host ""
      Write-Host "[HINT] Remote has new commits; run 'git pull --rebase' first, then push again." -ForegroundColor Yellow
      exit 2
    }
    $first = ($out | Select-Object -First 1 | Out-String).Trim()
    if ($first) { Write-Host "        failed: $first" -ForegroundColor DarkGray }
  }
  return $code
}

$tried = 0
for ($r = 1; $r -le $Rounds; $r++) {
  Write-Host "===== Round $r / $Rounds =====" -ForegroundColor Cyan

  foreach ($ip in $ips) {
    $tried++
    $code = Invoke-GitPush "direct $ip" $ip ""
    if ($code -eq 0) {
      Write-Host ""
      Write-Host "PUSH OK (tried $tried times)." -ForegroundColor Green
      exit 0
    }
  }

  foreach ($ip in $ips) {
    $tried++
    $code = Invoke-GitPush "proxy $ip" $ip $Proxy
    if ($code -eq 0) {
      Write-Host ""
      Write-Host "PUSH OK via proxy (tried $tried times)." -ForegroundColor Green
      exit 0
    }
  }

  if ($r -lt $Rounds) {
    Write-Host "All failed this round; retry in $DelaySec sec..." -ForegroundColor DarkGray
    Start-Sleep -Seconds $DelaySec
  }
}

Write-Host ""
Write-Host "Gave up after $Rounds rounds ($($ips.Count * 2) schemes per round)." -ForegroundColor Red
Write-Host "Check network / proxy ($Proxy or TUN mode), then rerun this script." -ForegroundColor Yellow
exit 1
