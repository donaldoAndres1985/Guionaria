# Empaqueta guionaria-core con PyInstaller como sidecar de Tauri.
# Resultado: apps/desktop/src-tauri/binaries/guionaria-core-<target-triple>.exe
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$coreDir = Join-Path $root 'core'
$binDir = Join-Path $root 'apps\desktop\src-tauri\binaries'

# Tauri exige el sufijo con el target triple de Rust (p. ej. x86_64-pc-windows-msvc).
$triple = ((rustc -vV) | Select-String '^host: (.+)$').Matches[0].Groups[1].Value
if (-not $triple) { throw 'No se pudo obtener el target triple con rustc -vV' }

Push-Location $coreDir
try {
    uv run pyinstaller `
        --noconfirm --clean --onefile `
        --name guionaria-core `
        --distpath build\dist --workpath build\work --specpath build `
        --add-data "$coreDir\guionaria_core\migrations;guionaria_core\migrations" `
        --collect-submodules uvicorn `
        --collect-submodules guionaria_core `
        guionaria_core\__main__.py
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller terminó con código $LASTEXITCODE" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force $binDir | Out-Null
$target = Join-Path $binDir "guionaria-core-$triple.exe"
Copy-Item (Join-Path $coreDir 'build\dist\guionaria-core.exe') $target -Force
Write-Host "[sidecar] Listo: $target"
