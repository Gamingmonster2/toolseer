# ============================================================================
#  build.ps1 — builds the ToolSeer Android app with the portable toolchain.
#
#      powershell -ExecutionPolicy Bypass -File build.ps1
#      powershell -ExecutionPolicy Bypass -File build.ps1 -Task bundleRelease
# ============================================================================
[CmdletBinding()]
param(
    [string]$Task = 'assembleDebug',
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$root  = $PSScriptRoot
$tools = 'C:\Android Apps Application\tools'
$sdk   = Join-Path $tools 'android-sdk'

$jdk = Get-ChildItem (Join-Path $tools 'jdk21') -Directory -ErrorAction SilentlyContinue |
       Select-Object -First 1 -ExpandProperty FullName
if (-not $jdk) { throw "JDK not found under $tools\jdk21" }
if (-not (Test-Path $sdk)) { throw "Android SDK not found at $sdk" }

$env:JAVA_HOME        = $jdk
$env:ANDROID_HOME     = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path             = "$jdk\bin;$env:Path"

Write-Host "JAVA_HOME = $jdk" -ForegroundColor Cyan
Write-Host "SDK       = $sdk" -ForegroundColor Cyan
Write-Host "Task      = $Task" -ForegroundColor Cyan

$gradlew = Join-Path $root 'gradlew.bat'
$args = @('--no-daemon', '-p', $root)
if ($Clean) { $args += 'clean' }
$args += $Task

& $gradlew @args
exit $LASTEXITCODE
