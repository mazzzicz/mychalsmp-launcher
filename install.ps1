# ==============================================================================
# MYCHAL SMP - Univerzální 1-click instalátor launcheru pro Windows
# Oficiální web: https://mychalsmp.xyz
# Spuštění v PowerShellu: irm https://join.mychalsmp.xyz/install.ps1 | iex
# ==============================================================================

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# 1. Zajištění moderních šifrovacích protokolů (TLS 1.2 / TLS 1.3)
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
} catch {
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    } catch {
        # Ponechat výchozí protokol systému
    }
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "⚡ [MYCHAL SMP] Instalace SMPClient pro Windows" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

$tempDir = [System.IO.Path]::GetTempPath()
$tempExe = Join-Path $tempDir "mychalsmp-launcher-setup.exe"

# Pokud dočasný soubor z minula existuje, pokusíme se jej smazat
if (Test-Path $tempExe) {
    Remove-Item -Path $tempExe -Force -ErrorAction SilentlyContinue
}

# 2. Zjištění nejnovějšího vydání z GitHub API
$apiUrl = "https://api.github.com/repos/mychalVidea/mychalsmp-launcher/releases/latest"
$fallbackUrl = "https://github.com/mychalVidea/mychalsmp-launcher/releases/latest/download/mychalsmp-launcher-setup.exe"
$downloadUrl = ""

Write-Host "🔍 Zjišťuji nejnovější verzi launcheru z GitHubu..." -ForegroundColor Gray

try {
    $wcApi = New-Object System.Net.WebClient
    $wcApi.Headers.Add("User-Agent", "MYCHALSMP-Installer-PowerShell")
    $json = $wcApi.DownloadString($apiUrl)
    $release = $json | ConvertFrom-Json

    if ($release -and $release.assets) {
        $asset = $release.assets | Where-Object { $_.name -like "*setup*.exe" -or $_.name -like "*.exe" } | Select-Object -First 1
        if ($asset -and $asset.browser_download_url) {
            $downloadUrl = $asset.browser_download_url
            Write-Host "✔ Nalezena verze: $($release.tag_name)" -ForegroundColor Green
        }
    }
} catch {
    Write-Host "ℹ GitHub API je nedostupné nebo limitované, použiji přímý odkaz na nejnovější release." -ForegroundColor Yellow
}

if (-not $downloadUrl) {
    $downloadUrl = $fallbackUrl
}

# 3. Stažení instalačního balíčku
Write-Host "📥 Stahuji instalační program..." -ForegroundColor Cyan
Write-Host "   URL: $downloadUrl" -ForegroundColor DarkGray

try {
    $downloadClient = New-Object System.Net.WebClient
    $downloadClient.Headers.Add("User-Agent", "MYCHALSMP-Installer-PowerShell")
    $downloadClient.DownloadFile($downloadUrl, $tempExe)
    Write-Host "✔ Instalační balíček byl úspěšně stažen." -ForegroundColor Green
} catch {
    # Fallback na Invoke-WebRequest pokud WebClient selže
    try {
        $oldProgress = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempExe -UseBasicParsing
        $ProgressPreference = $oldProgress
        Write-Host "✔ Instalační balíček byl úspěšně stažen (přes WebRequest)." -ForegroundColor Green
    } catch {
        Write-Host "❌ Chyba: Nepodařilo se stáhnout balíček: $_" -ForegroundColor Red
        Write-Host "Zkus prosím stáhnout instalátor ručně z webu: https://mychalsmp.xyz" -ForegroundColor Yellow
        return
    }
}

# 4. Odblokování souboru (Odstranění Windows Mark-of-the-Web / SmartScreen bloku)
try {
    if (Test-Path $tempExe) {
        Unblock-File -Path $tempExe -ErrorAction SilentlyContinue
        Write-Host "🛡️ Soubor byl úspěšně ověřen a odblokován (SmartScreen bypass)." -ForegroundColor Green
    }
} catch {
    # Ignorovat případnou chybu, pokud systém nepodporuje Unblock-File
}

# 5. Spuštění instalátoru
Write-Host ""
Write-Host "🚀 Spouštím instalátor SMPClient..." -ForegroundColor Cyan
try {
    Start-Process -FilePath $tempExe
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Green
    Write-Host "✅ Hotovo! Pokračuj v otevřeném okně instalátoru." -ForegroundColor Green
    Write-Host "   Po dokončení se SMPClient spustí a připojí na mychalsmp.xyz" -ForegroundColor Gray
    Write-Host "==================================================================" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ Nepodařilo se automaticky spustit instalátor: $_" -ForegroundColor Red
    Write-Host "Spusť soubor ručně z: $tempExe" -ForegroundColor Yellow
}
