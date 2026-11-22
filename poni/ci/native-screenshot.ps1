$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System.Runtime.InteropServices;
public static class CursorPosition {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
'@
$outputDir = Join-Path $env:GITHUB_WORKSPACE 'native-observation'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$env:APPDATA = Join-Path $env:RUNNER_TEMP 'poni-rebuild-profile'
New-Item -ItemType Directory -Force -Path $env:APPDATA | Out-Null
$exe = Join-Path $env:GITHUB_WORKSPACE 'poni/src-tauri/target/release/poni-rebuild.exe'
$process = Start-Process -FilePath $exe -PassThru
try {
    Start-Sleep -Seconds 15
    $process.Refresh()
    if ($process.HasExited) { throw "Application exited with code $($process.ExitCode)" }
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    [CursorPosition]::SetCursorPos([int]($bounds.X + $bounds.Width / 2), [int]($bounds.Y + 12)) | Out-Null
    Start-Sleep -Seconds 5
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $bitmap.Save((Join-Path $outputDir 'desktop.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    @{ process_id = $process.Id; main_window_handle = $process.MainWindowHandle.ToInt64(); screenshot = 'desktop.png' } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'observation.json') -Encoding UTF8
} finally {
    if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
