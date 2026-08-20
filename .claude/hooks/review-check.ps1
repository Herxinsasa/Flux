<#
.SYNOPSIS
  Verify that staged code is covered by the latest code review.
.DESCRIPTION
  -Snapshot prints hashes for current changed code files. code-review stores
  these values in .claude/.review-status.json. Default mode compares staged
  code blobs with those hashes and blocks missing reviewer identity,
  unreviewed code, or code changed after review.
#>

param(
  [switch]$Snapshot,
  [string[]]$Files
)

$ErrorActionPreference = "Continue"
$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$claudeDir = Split-Path -Parent $PSScriptRoot
$reviewStatusFile = Join-Path $claudeDir ".review-status.json"
$codePattern = '\.(ps1|py|js|mjs|cjs|ts|jsx|tsx|vue|rs|go|java|cs|cpp|c|h|cxx|hpp|swift|kt|kts|proto|lua|qml|ui)$'

function Normalize-Path([string]$path) {
  return ($path.Trim() -replace '\\', '/')
}

function Get-WorkingCodeFiles {
  $tracked = @(& git -C "$rootDir" diff HEAD --name-only --diff-filter=ACMRDTUXB 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "Cannot read working tree diff." }
  $untracked = @(& git -C "$rootDir" ls-files --others --exclude-standard 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "Cannot read untracked files." }

  return @($tracked + $untracked |
    ForEach-Object { Normalize-Path "$_" } |
    Where-Object { $_ -match $codePattern -and $_ -notmatch '^\.claude/' } |
    Sort-Object -Unique)
}

function Get-StagedCodeFiles {
  $files = @(& git -C "$rootDir" diff --cached --name-only --diff-filter=ACMRDTUXB 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "Cannot read staged diff." }

  return @($files |
    ForEach-Object { Normalize-Path "$_" } |
    Where-Object { $_ -match $codePattern -and $_ -notmatch '^\.claude/' } |
    Sort-Object -Unique)
}

function Get-WorkingBlobHash([string]$path) {
  $relativePath = $path -replace '/', [IO.Path]::DirectorySeparatorChar
  $absolutePath = Join-Path $rootDir $relativePath
  if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) { return "DELETED" }

  $hash = & git -C "$rootDir" hash-object -- "$path" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $hash) { throw "Cannot hash working file: $path" }
  return "$hash".Trim()
}

function Get-StagedBlobHash([string]$path) {
  & git -C "$rootDir" cat-file -e ":$path" 2>$null
  if ($LASTEXITCODE -ne 0) { return "DELETED" }

  $hash = & git -C "$rootDir" rev-parse ":$path" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $hash) { throw "Cannot hash staged file: $path" }
  return "$hash".Trim()
}

if ($Snapshot) {
  if ($Files -and $Files.Count -gt 0) {
    $files = @($Files |
      ForEach-Object { Normalize-Path "$_" } |
      Where-Object { $_ -match $codePattern -and $_ -notmatch '^\.claude/' } |
      Sort-Object -Unique)
  } else {
    $files = @(Get-WorkingCodeFiles)
  }
  $hashes = [ordered]@{}
  foreach ($file in $files) {
    $hashes[$file] = Get-WorkingBlobHash $file
  }

  $fingerprintInput = @($hashes.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
  $fingerprintBytes = [Text.Encoding]::UTF8.GetBytes($fingerprintInput)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $fingerprint = ([BitConverter]::ToString($sha256.ComputeHash($fingerprintBytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }

  [ordered]@{
    reviewed_files = $files
    reviewed_file_hashes = $hashes
    diff_fingerprint = $fingerprint
  } | ConvertTo-Json -Depth 6
  exit 0
}

$stagedFiles = @(Get-StagedCodeFiles)
if ($stagedFiles.Count -eq 0) {
  Write-Host "[pre-commit] No staged code files; review check skipped."
  exit 0
}

if (-not (Test-Path -LiteralPath $reviewStatusFile)) {
  Write-Host "[pre-commit] Missing .claude/.review-status.json; run code-review first."
  exit 1
}

try {
  $reviewData = Get-Content -LiteralPath $reviewStatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Write-Host "[pre-commit] Invalid .claude/.review-status.json; run code-review again."
  exit 1
}

$validConclusion = @("通过", "有条件通过", "PASS") -contains [string]$reviewData.conclusion
if (-not $validConclusion) {
  Write-Host "[pre-commit] Latest code-review did not pass."
  exit 1
}

if ([string]$reviewData.review_agent_name -ne "code-reviewer" -or
    [string]::IsNullOrWhiteSpace([string]$reviewData.review_agent_id)) {
  Write-Host "[pre-commit] Review status has no independent code-reviewer execution ID; run code-review again."
  exit 1
}

$reviewedHashes = $reviewData.reviewed_file_hashes
if ($null -eq $reviewedHashes) {
  Write-Host "[pre-commit] Review status has no file hashes; run code-review again."
  exit 1
}

$failed = @()
foreach ($file in $stagedFiles) {
  $property = $reviewedHashes.PSObject.Properties[$file]
  if ($null -eq $property) {
    $failed += "$file (not reviewed)"
    continue
  }

  $stagedHash = Get-StagedBlobHash $file
  if ([string]$property.Value -ne $stagedHash) {
    $failed += "$file (changed after review)"
  }
}

if ($failed.Count -gt 0) {
  Write-Host "[pre-commit] Code review check failed:"
  $failed | ForEach-Object { Write-Host "  - $_" }
  Write-Host "[pre-commit] Run code-review for the current code before committing."
  exit 1
}

Write-Host "[pre-commit] Code review hashes match staged code."
exit 0
