# Empaqueta guionaria-core con PyInstaller como sidecar de Tauri.
# Resultado: apps/desktop/src-tauri/binaries/guionaria-core-<target-triple>.exe
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$coreDir = Join-Path $root 'core'
$binDir = Join-Path $root 'apps\desktop\src-tauri\binaries'

# Tauri exige el sufijo con el target triple de Rust (p. ej. x86_64-pc-windows-msvc).
$triple = ((rustc -vV) | Select-String '^host: (.+)$').Matches[0].Groups[1].Value
if (-not $triple) { throw 'No se pudo obtener el target triple con rustc -vV' }

# Piper: solo los datos de espeak-ng (los de hebreo y árabe no se usan y pesan 26 MB).
$piperData = Join-Path $coreDir '.venv\Lib\site-packages\piper\espeak-ng-data'

# PyInstaller copia el runtime de C++ (msvcp140.dll) que encuentra primero en el PATH. Si es
# una versión vieja (p. ej. la de un JDK), onnxruntime se cae al cargar: se usa solo la de Windows.
$env:Path = ($env:Path -split ';' | Where-Object {
    $_ -and ($_ -like "$env:SystemRoot*" -or -not (Test-Path (Join-Path $_ 'msvcp140.dll')))
}) -join ';'

Push-Location $coreDir
try {
    uv run pyinstaller `
        --noconfirm --clean --onefile `
        --name guionaria-core `
        --distpath build\dist --workpath build\work --specpath build `
        --add-data "$coreDir\guionaria_core\migrations;guionaria_core\migrations" `
        --add-data "$coreDir\guionaria_core\prompts;guionaria_core\prompts" `
        --collect-submodules uvicorn `
        --collect-submodules guionaria_core `
        --collect-submodules yt_dlp `
        --add-data "$piperData;piper\espeak-ng-data" `
        --collect-binaries onnxruntime `
        --collect-data faster_whisper `
        --collect-binaries ctranslate2 `
        --collect-all opentimelineio `
        --collect-submodules mcp.server `
        --collect-submodules mcp.shared `
        --exclude-module mcp.cli `
        --exclude-module piper.train `
        guionaria_core\__main__.py
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller terminó con código $LASTEXITCODE" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force $binDir | Out-Null
$target = Join-Path $binDir "guionaria-core-$triple.exe"
Copy-Item (Join-Path $coreDir 'build\dist\guionaria-core.exe') $target -Force
Write-Host "[sidecar] Listo: $target"
