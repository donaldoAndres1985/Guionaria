# Arranca el núcleo (uvicorn con recarga) y la app Tauri en modo desarrollo.
# Uso: npm run dev   (desde la raíz del repo)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$portInUse = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
$core = $null
if ($portInUse) {
    Write-Host '[dev] El puerto 8765 ya está en uso: se reutiliza el núcleo que está corriendo.'
} else {
    Write-Host '[dev] Iniciando guionaria-core en http://127.0.0.1:8765 (ventana minimizada aparte) ...'
    # Consola propia: al recargar, uvicorn envía Ctrl+C a toda la consola y cerraría Tauri y npm.
    $core = Start-Process -FilePath 'uv' `
        -ArgumentList 'run', 'guionaria-core', 'serve', '--reload' `
        -WorkingDirectory (Join-Path $root 'core') `
        -WindowStyle Minimized -PassThru
}

try {
    Push-Location $root
    npm run tauri -w '@guionaria/desktop' -- dev
} finally {
    Pop-Location
    if ($core -and -not $core.HasExited) {
        # --reload crea procesos hijos: se cierra el árbol completo.
        taskkill /PID $core.Id /T /F | Out-Null
        Write-Host '[dev] Núcleo detenido.'
    }
}
