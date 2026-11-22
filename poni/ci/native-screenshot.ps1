$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CursorPosition {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr window, out Rect rect);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
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
    [CursorPosition]::SetCursorPos([int]($bounds.X + 10), [int]($bounds.Y + $bounds.Height - 10)) | Out-Null
    Start-Sleep -Seconds 2
    # Alt+N should open the compact window even when the pointer is elsewhere.
    [CursorPosition]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [CursorPosition]::keybd_event(0x4E, 0, 0, [UIntPtr]::Zero)
    [CursorPosition]::keybd_event(0x4E, 0, 2, [UIntPtr]::Zero)
    [CursorPosition]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Seconds 3
    $process.Refresh()
    $rect = [CursorPosition+Rect]::new()
    if (![CursorPosition]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) { throw 'Could not inspect the Poni window.' }
    $windowWidth = $rect.Right - $rect.Left
    if ($windowWidth -lt 500) { throw "Alt+N did not open the panel; width is $windowWidth pixels." }
    function Save-Screen([string]$name) {
        $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            $bitmap.Save((Join-Path $outputDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
    function Click-Point([int]$x, [int]$y) {
        [CursorPosition]::SetCursorPos($x, $y) | Out-Null
        [CursorPosition]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        [CursorPosition]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    }
    Save-Screen 'desktop.png'
    # The positions correspond to the 1024x768 reference runner; screenshots record outcomes.
    if ($bounds.Width -eq 1024 -and $bounds.Height -eq 768) {
        Click-Point ($rect.Left + 209) ($rect.Top + 32)
        Start-Sleep -Seconds 2
        Click-Point ($rect.Left + 100) ($rect.Top + 65)
        foreach ($character in 'JAKARTA'.ToCharArray()) {
            $key = [byte][int][char]$character
            [CursorPosition]::keybd_event($key, 0, 0, [UIntPtr]::Zero)
            [CursorPosition]::keybd_event($key, 0, 2, [UIntPtr]::Zero)
        }
        [CursorPosition]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero)
        [CursorPosition]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)
        Start-Sleep -Seconds 10
        Save-Screen 'weather-search.png'
        Click-Point ($rect.Left + 100) ($rect.Top + 100)
        Start-Sleep -Seconds 12
        Save-Screen 'weather-result.png'
    }
    @{ process_id = $process.Id; main_window_handle = $process.MainWindowHandle.ToInt64(); screenshot = 'desktop.png'; width_after_shortcut = $windowWidth; weather_attempted = ($bounds.Width -eq 1024 -and $bounds.Height -eq 768) } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'observation.json') -Encoding UTF8
} finally {
    if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
