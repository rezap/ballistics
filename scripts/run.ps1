#Requires -Version 5.1
<#
.SYNOPSIS
    Runs the full workspace test suite, then starts the ballistics-api web
    server, but only if every test passes.

.DESCRIPTION
    Equivalent to running:
        cargo test --workspace
        cargo run -p ballistics-api
    back to back, except it stops before starting the server if any test
    fails, and it works no matter which directory you invoke it from.

.EXAMPLE
    .\scripts\run.ps1

    If your terminal blocks the script from running with an error like
    "cannot be loaded because running scripts is disabled on this system",
    run it once via:
        powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1
#>

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "==> Running cargo test --workspace" -ForegroundColor Cyan
cargo test --workspace
if ($LASTEXITCODE -ne 0) {
    Write-Host "==> Tests failed (exit code $LASTEXITCODE). Server not started." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "==> All tests passed." -ForegroundColor Green

# The solver compiled for the browser, so the page calculates on this
# machine rather than asking the server each time - and keeps calculating
# with no signal. Built fresh every run and copied where the server serves
# it from; a copy left over from older code would give old answers.
#
# If it cannot be built, the page still works, solving on the server
# instead, so this warns rather than stopping.
$wasmDir = Join-Path $repoRoot "crates\ballistics-api\static\wasm"
Write-Host ""
Write-Host "==> Building the in-browser solver (ballistics-wasm)" -ForegroundColor Cyan
# Without rustup (a toolchain installed some other way) the target may
# still be there, so the build is tried regardless.
if (Get-Command rustup -ErrorAction SilentlyContinue) {
    rustup target add wasm32-unknown-unknown
}
cargo build -p ballistics-wasm --target wasm32-unknown-unknown --profile wasm
if ($LASTEXITCODE -eq 0) {
    New-Item -ItemType Directory -Force -Path $wasmDir | Out-Null
    Copy-Item -Force (Join-Path $repoRoot "target\wasm32-unknown-unknown\wasm\ballistics_wasm.wasm") $wasmDir
    Write-Host "==> In-browser solver ready." -ForegroundColor Green
} else {
    Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $wasmDir "ballistics_wasm.wasm")
    Write-Host "==> Could not build the in-browser solver. The page will solve on the server instead." -ForegroundColor Yellow
}

# cargo run keeps the working directory you invoked it from, not the crate
# directory, so ballistics-api's default "look for ./static next to me"
# behavior would break if this script is run from the repo root. Point it
# at the real static directory explicitly so it works from anywhere.
$env:BALLISTICS_STATIC_DIR = Join-Path $repoRoot "crates\ballistics-api\static"

Write-Host ""
Write-Host "==> Starting the server. Once it says 'listening', open this in your browser:" -ForegroundColor Cyan
Write-Host "        http://localhost:3000" -ForegroundColor Yellow
Write-Host "    (Do not open static\index.html directly - it must be loaded through the server. Ctrl+C here to stop.)" -ForegroundColor Cyan
Write-Host ""
cargo run -p ballistics-api
exit $LASTEXITCODE
