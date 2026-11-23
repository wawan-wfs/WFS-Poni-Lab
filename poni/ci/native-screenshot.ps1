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
    [DllImport("user32.dll", EntryPoint="FindWindowW", CharSet=CharSet.Unicode, ExactSpelling=true)] private static extern IntPtr FindWindow(string className, string title);
    public static IntPtr FindWindowByTitle(string title) => FindWindow(null, title);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr window, out uint processId);
    [DllImport("user32.dll", EntryPoint="PostMessageW")] public static extern bool PostMessage(System.IntPtr window, uint message, System.IntPtr wParam, System.IntPtr lParam);
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
    $hoverImage = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $hoverGraphics = [System.Drawing.Graphics]::FromImage($hoverImage)
    try {
        $hoverGraphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $hoverImage.Save((Join-Path $outputDir 'home-hover.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $hoverGraphics.Dispose(); $hoverImage.Dispose() }
    [CursorPosition]::SetCursorPos([int]($bounds.X + 10), [int]($bounds.Y + $bounds.Height - 10)) | Out-Null
    Start-Sleep -Seconds 2
    $process.Refresh()
    $before = [CursorPosition+Rect]::new()
    if (![CursorPosition]::GetWindowRect($process.MainWindowHandle, [ref]$before)) { throw 'Could not inspect the initial Poni window.' }
    $beforeWidth = $before.Right - $before.Left
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
    if ($windowWidth -lt 500) {
        $failedImage = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
        $failedGraphics = [System.Drawing.Graphics]::FromImage($failedImage)
        try {
            $failedGraphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            $failedImage.Save((Join-Path $outputDir 'shortcut-failure.png'), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $failedGraphics.Dispose(); $failedImage.Dispose() }
        throw "Alt+N did not open the panel; widths before/after were $beforeWidth/$windowWidth pixels."
    }
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
    # Alt+N opened Home. Left wraps to Currency, a module that needs the taller panel.
    [CursorPosition]::keybd_event(0x25, 0, 0, [UIntPtr]::Zero)
    [CursorPosition]::keybd_event(0x25, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Seconds 2
    $moduleRect = [CursorPosition+Rect]::new()
    if (![CursorPosition]::GetWindowRect($process.MainWindowHandle, [ref]$moduleRect)) { throw 'Could not inspect the module window.' }
    $moduleHeight = $moduleRect.Bottom - $moduleRect.Top
    $homeHeight = $rect.Bottom - $rect.Top
    Save-Screen 'currency.png'
    if ($moduleHeight -lt $homeHeight + 100) { throw "Module did not expand the panel; heights were $homeHeight/$moduleHeight pixels." }
    foreach ($module in @('chat', 'bluetooth', 'ai-usage')) {
        [CursorPosition]::keybd_event(0x25, 0, 0, [UIntPtr]::Zero)
        [CursorPosition]::keybd_event(0x25, 0, 2, [UIntPtr]::Zero)
        Start-Sleep -Seconds 2
        Save-Screen "$module.png"
    }
    for ($i = 0; $i -lt 4; $i++) {
        [CursorPosition]::keybd_event(0x27, 0, 0, [UIntPtr]::Zero)
        [CursorPosition]::keybd_event(0x27, 0, 2, [UIntPtr]::Zero)
    }
    Start-Sleep -Seconds 2
    $homeRect = [CursorPosition+Rect]::new()
    if (![CursorPosition]::GetWindowRect($process.MainWindowHandle, [ref]$homeRect) -or ($homeRect.Bottom - $homeRect.Top) -ne $homeHeight) {
        throw 'Home did not return to the compact height.'
    }
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
        Start-Sleep -Seconds 25
        Save-Screen 'weather-result.png'
        try {
            $uri = 'https://api.open-meteo.com/v1/forecast?latitude=-6.2&longitude=106.8&current=temperature_2m%2Crelative_humidity_2m%2Cweather_code%2Cwind_speed_10m&daily=temperature_2m_max%2Ctemperature_2m_min%2Cweather_code&timezone=auto&forecast_days=7'
            $forecast = Invoke-RestMethod -Uri $uri -TimeoutSec 20
            @{ ok = $true; days = @($forecast.daily.time).Count; current_present = ($null -ne $forecast.current) } |
                ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'weather-probe.json') -Encoding UTF8
        } catch {
            @{ ok = $false; error = $_.Exception.Message } |
                ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'weather-probe.json') -Encoding UTF8
        }
        Click-Point ($rect.Left + 290) ($rect.Top + 32)
        Start-Sleep -Seconds 5
        Save-Screen 'system.png'
    }
    $mainHandle = $process.MainWindowHandle
    Click-Point ($rect.Right - 93) ($rect.Top + 25)
    $settingsHandle = [IntPtr]::Zero
    for ($attempt = 0; $attempt -lt 8 -and $settingsHandle -eq [IntPtr]::Zero; $attempt++) {
        Start-Sleep -Milliseconds 750
        $settingsHandle = [CursorPosition]::FindWindowByTitle('Poni Settings')
    }
    Save-Screen 'settings.png'
    if ($settingsHandle -eq [IntPtr]::Zero -or $settingsHandle -eq $mainHandle) {
        throw 'The gear did not open a separate Poni Settings window.'
    }
    $settingsPid = [uint32]0
    [CursorPosition]::GetWindowThreadProcessId($settingsHandle, [ref]$settingsPid) | Out-Null
    if ($settingsPid -ne [uint32]$process.Id) { throw 'Settings window belongs to another process.' }
    $settingsRect = [CursorPosition+Rect]::new()
    if (![CursorPosition]::GetWindowRect($settingsHandle, [ref]$settingsRect)) {
        throw 'Could not inspect the separate Settings window.'
    }
    $settingsWidth = $settingsRect.Right - $settingsRect.Left
    $screenTimeChecked = $false
    $pomodoroChecked = $false
    if ($bounds.Width -eq 1024 -and $bounds.Height -eq 768) {
        function Find-Setting([string]$text) {
            Click-Point ($settingsRect.Left + 102) ($settingsRect.Top + 98)
            Start-Sleep -Milliseconds 200
            [CursorPosition]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
            [CursorPosition]::keybd_event(0x41, 0, 0, [UIntPtr]::Zero)
            [CursorPosition]::keybd_event(0x41, 0, 2, [UIntPtr]::Zero)
            [CursorPosition]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 200
            [System.Windows.Forms.SendKeys]::SendWait($text)
            Start-Sleep -Milliseconds 400
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
            Start-Sleep -Milliseconds 400
        }

        Find-Setting 'stop counting after idle'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'excluded executable'
        [System.Windows.Forms.SendKeys]::SendWait('notepad.exe{ENTER}')
        Start-Sleep -Seconds 2
        Save-Screen 'settings-screentime.png'

        $dataPaths = @($env:APPDATA, [Environment]::GetFolderPath('ApplicationData')) |
            ForEach-Object { Join-Path $_ 'id.wfs.ponirebuild/data.json' } |
            Select-Object -Unique
        $dataPath = $dataPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (!$dataPath) { throw 'Screen Time changes did not create the application profile.' }
        $screenTime = (Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json).screen_time
        if ($screenTime.idle_seconds -ne 600 -or @($screenTime.excluded_apps) -notcontains 'notepad.exe') {
            throw 'Screen Time did not save the idle limit and excluded executable.'
        }
        $screenTimeChecked = $true

        Find-Setting 'focus sessions before a long break'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'add remove countdown'
        [System.Windows.Forms.SendKeys]::SendWait('35{ENTER}')
        Start-Sleep -Seconds 2
        Find-Setting 'start a break after the timer'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Find-Setting 'pomodoro background audio noise'
        [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
        Start-Sleep -Seconds 2
        Find-Setting 'keep playing in breaks'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Save-Screen 'settings-pomodoro.png'

        $profile = Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json
        $observed = @{
            cycle_length = $profile.pomodoro.settings.cycle_length
            preset_saved = @($profile.settings.timer_presets) -contains 35
            timer_then_break = $profile.settings.timer_then_break
            focus_sound = $profile.pomodoro.settings.focus_sound
            focus_sound_breaks = $profile.pomodoro.settings.focus_sound_breaks
        }
        $observed | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'pomodoro-settings.json') -Encoding UTF8
        if ($observed.cycle_length -ne 8 -or !$observed.preset_saved -or !$observed.timer_then_break -or
            $observed.focus_sound -ne 'white' -or !$observed.focus_sound_breaks) {
            throw ('Unexpected Pomodoro settings after native input: ' + ($observed | ConvertTo-Json -Compress))
        }
        $pomodoroChecked = $true
    }
    [CursorPosition]::PostMessage($settingsHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Seconds 2
    if ($process.HasExited -or [CursorPosition]::FindWindowByTitle('Poni Settings') -ne [IntPtr]::Zero) {
        throw 'Closing Settings did not leave the notch running independently.'
    }
    @{ process_id = $process.Id; main_window_handle = $mainHandle.ToInt64(); screenshot = 'desktop.png'; width_after_shortcut = $windowWidth; module_height = $moduleHeight; settings_width = $settingsWidth; settings_window_handle = $settingsHandle.ToInt64(); settings_closed_independently = $true; screen_time_saved = $screenTimeChecked; pomodoro_saved = $pomodoroChecked; weather_attempted = ($bounds.Width -eq 1024 -and $bounds.Height -eq 768) } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'observation.json') -Encoding UTF8
} finally {
    if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
