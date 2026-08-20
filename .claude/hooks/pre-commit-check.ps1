<#
.SYNOPSIS
  Git pre-commit build check.
.DESCRIPTION
  Runs a best-effort build check before git commit.
  Build failures block the commit and should be routed to bug-fixer.
#>

$ErrorActionPreference = "Continue"
$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$hasXmake = Test-Path "$rootDir\xmake.lua"
$hasCmake = Test-Path "$rootDir\CMakeLists.txt"
$hasPackageJson = Test-Path "$rootDir\package.json"
$hasCargoToml = Test-Path "$rootDir\Cargo.toml"
$hasGoMod = Test-Path "$rootDir\go.mod"
$hasCsproj = Get-ChildItem "$rootDir" -Filter "*.csproj" -Recurse -ErrorAction SilentlyContinue
$hasPyProject = (Test-Path "$rootDir\pyproject.toml") -or (Test-Path "$rootDir\setup.py")

$buildFailed = $false
$buildCommand = ""

if ($hasXmake) {
  $buildCommand = "xmake build"
  Write-Host "[pre-commit] xmake project detected; running build check..."
  & xmake build 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { $buildFailed = $true }
} elseif ($hasCmake) {
  $buildCommand = "cmake --build build"
  Write-Host "[pre-commit] CMake project detected; running build check..."
  & cmake --build build 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { $buildFailed = $true }
} elseif ($hasPackageJson) {
  $buildCommand = "npm run build"
  Write-Host "[pre-commit] Node.js project detected; running build check..."
  if (Test-Path "$rootDir\node_modules") {
    & npm --prefix "$rootDir" run build 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { $buildFailed = $true }
  } else {
    Write-Host "[pre-commit] node_modules not found; skipping npm build."
  }
} elseif ($hasCargoToml) {
  $buildCommand = "cargo build"
  Write-Host "[pre-commit] Rust project detected; running build check..."
  & cargo build --manifest-path "$rootDir\Cargo.toml" 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { $buildFailed = $true }
} elseif ($hasGoMod) {
  $buildCommand = "go build ./..."
  Write-Host "[pre-commit] Go project detected; running build check..."
  & go build ./... 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { $buildFailed = $true }
} elseif ($hasCsproj) {
  $buildCommand = "dotnet build"
  Write-Host "[pre-commit] .NET project detected; running build check..."
  & dotnet build "$rootDir" 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { $buildFailed = $true }
} elseif ($hasPyProject) {
  $buildCommand = "python -m compileall"
  Write-Host "[pre-commit] Python project detected; running syntax check..."
  & python -m compileall "$rootDir" -q 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { $buildFailed = $true }
} else {
  Write-Host "[pre-commit] No known project type detected; skipping build check."
}

if ($buildFailed) {
  Write-Host "[pre-commit] Build check failed; blocking commit."
  Write-Host "[pre-commit] Failed command: $buildCommand"
  Write-Host "[pre-commit] Route to bug-fixer: collect logs, reproduce, find root cause, apply minimal fix, then retry commit."
  exit 1
}

exit 0
