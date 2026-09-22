# SwimZone cleanup — delete confirmed-dead files
# Verified 2026-09-19 by tracing every import reachable from src/main.jsx;
# these files were not reached and are not the intentional 'index.js' barrel
# convention (athlete/index.js is kept even though currently unused, since
# it matches the session/ and drills/ barrel pattern the project already
# uses elsewhere).
#
# Run from the project root: D:\AlsCode\swimzone_v2 - 240526
# Usage:  powershell -ExecutionPolicy Bypass -File .\delete-dead-files.ps1
# (dry run first: add -WhatIf to the Remove-Item line, or just read the list)

$root = Join-Path $PSScriptRoot "src"
if (-not (Test-Path $root)) { $root = "src" }  # fallback if run from project root already

$files = @(
  "App-original.jsx",
  "App-modular-attempt.jsx",
  "SupabaseTest.jsx",
  "styles\theme.js",
  "athlete\athlete-index.js",
  "session\session-index.js",
  "session\sessionService.js",
  "zones\zones-index.js",
  "hooks\index.js",
  "hooks\useAthleteSetup.js",
  "hooks\useClassifier.js",
  "hooks\useSessionBuilder.js",
  "hooks\athlete\index.js",
  "hooks\athlete\parse.js",
  "hooks\components\EnergyGraph.jsx",
  "hooks\components\ProtectedRoute.jsx",
  "hooks\components\RepChart.jsx",
  "hooks\components\SbBlockEditor.jsx",
  "hooks\components\SbBlockView.jsx",
  "hooks\components\SbLineEditor.jsx",
  "hooks\components\SbLineView.jsx",
  "hooks\components\ZoneBar.jsx",
  "hooks\drills\index.js",
  "hooks\drills\library.js",
  "hooks\hooks\index.js",
  "hooks\hooks\useAthleteSetup.js",
  "hooks\hooks\useAuth.js",
  "hooks\hooks\useClassifier.js",
  "hooks\hooks\useSessionBuilder.js",
  "hooks\pages\Classifier.jsx",
  "hooks\pages\Dashboard.jsx",
  "hooks\pages\Login.jsx",
  "hooks\screens\AthleteSetupScreen.jsx",
  "hooks\screens\ClassifierScreen-clean.jsx",
  "hooks\screens\ClassifierScreen.jsx",
  "hooks\screens\ClassifierScreenRefactor.jsx",
  "hooks\screens\SetBuilderScreen.jsx",
  "hooks\screens\index.js",
  "hooks\services\athleteService.js",
  "hooks\services\auth.js",
  "hooks\services\classifierService.js",
  "hooks\services\sessionService.js",
  "hooks\session\index.js",
  "hooks\session\model.js",
  "hooks\styles\theme.js",
  "hooks\zones\classify.js",
  "hooks\zones\constants.js",
  "hooks\zones\energy.js",
  "hooks\zones\helpers.js",
  "hooks\zones\index.js",
  "hooks\zones\suggest.js",
  "hooks\zones\validatePace.js",
  "hooks\lib\classifier\helpers.js",
  "hooks\lib\classifier\index.js",
  "hooks\lib\sessions\builders.js",
  "hooks\lib\sessions\index.js",
  "hooks\lib\zones\index.js",
  "hooks\lib\zones\suggestions.js",
  "lib\classifier\helpers.js",
  "lib\classifier\index.js",
  "lib\sessions\builders.js",
  "lib\sessions\index.js",
  "lib\zones\index.js",
  "lib\zones\suggestions.js"
)

$missing = @()
foreach ($f in $files) {
  $full = Join-Path $root $f
  if (Test-Path $full) {
    Remove-Item $full -Force
    Write-Host "Deleted: $f"
  } else {
    $missing += $f
  }
}

if ($missing.Count -gt 0) {
  Write-Host ""
  Write-Host "Not found (already gone, or path mismatch) - check these manually:"
  $missing | ForEach-Object { Write-Host "  $_" }
}

# Remove now-empty directories left behind under hooks/ and lib/
Get-ChildItem -Path (Join-Path $root "hooks") -Recurse -Directory -ErrorAction SilentlyContinue |
  Sort-Object { $_.FullName.Length } -Descending |
  Where-Object { (Get-ChildItem $_.FullName -Force | Measure-Object).Count -eq 0 } |
  Remove-Item -Force

Get-ChildItem -Path (Join-Path $root "lib") -Recurse -Directory -ErrorAction SilentlyContinue |
  Sort-Object { $_.FullName.Length } -Descending |
  Where-Object { (Get-ChildItem $_.FullName -Force | Measure-Object).Count -eq 0 } |
  Remove-Item -Force

Write-Host ""
Write-Host "Done. hooks/useAuth.js, hooks/ (folder), athlete/index.js, lib/storage.js,"
Write-Host "and the 4 orphaned Classifier components were deliberately NOT touched."
Write-Host "Next: npm run dev (or npm run build) to confirm the app still builds."
