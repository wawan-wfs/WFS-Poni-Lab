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
    [DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(System.IntPtr window, ref Point point);
    [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(System.IntPtr window, out uint affinity);
    [DllImport("user32.dll", EntryPoint="FindWindowW", CharSet=CharSet.Unicode, ExactSpelling=true)] private static extern IntPtr FindWindow(string className, string title);
    public static IntPtr FindWindowByTitle(string title) => FindWindow(null, title);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr window, out uint processId);
    [DllImport("user32.dll", EntryPoint="PostMessageW")] public static extern bool PostMessage(System.IntPtr window, uint message, System.IntPtr wParam, System.IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
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
    if ($moduleHeight -le $homeHeight) { throw "Module did not expand the panel; heights were $homeHeight/$moduleHeight pixels." }
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
    $geometryChecked = $false
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

        $closedRect = [CursorPosition+Rect]::new()
        if (![CursorPosition]::GetWindowRect($mainHandle, [ref]$closedRect)) { throw 'Could not inspect the closed notch.' }
        Find-Setting 'closed notch width'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'gap from the top edge'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'position along the top'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        $newRect = [CursorPosition+Rect]::new()
        $clientRect = [CursorPosition+Rect]::new()
        $clientOrigin = [CursorPosition+Point]::new()
        if (![CursorPosition]::GetWindowRect($mainHandle, [ref]$newRect) -or
            ![CursorPosition]::GetClientRect($mainHandle, [ref]$clientRect) -or
            ![CursorPosition]::ClientToScreen($mainHandle, [ref]$clientOrigin)) {
            throw 'Could not read the resized notch.'
        }
        Save-Screen 'settings-notch-geometry.png'
        $newWidth = $clientRect.Right - $clientRect.Left
        $movedDown = $newRect.Top - $closedRect.Top
        $clientRight = $clientOrigin.X + $newWidth
        if ($newWidth -ne 320 -or $movedDown -ne 120 -or $clientRight -ne $bounds.Right -or $newRect.Left -le $closedRect.Left) {
            throw "Notch geometry did not take effect. Width: $newWidth, moved down: $movedDown, visible right edge: $clientRight of $($bounds.Right)."
        }

        Find-Setting 'show poni in screenshots'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        $affinity = [uint32]0
        $protected = [CursorPosition]::GetWindowDisplayAffinity($mainHandle, [ref]$affinity) -and ($affinity -band 1) -ne 0
        $protectedAffinity = $affinity
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        $restored = [CursorPosition]::GetWindowDisplayAffinity($mainHandle, [ref]$affinity) -and $affinity -eq 0
        @{
            closed_width = $newWidth; moved_down = $movedDown; original_x = $closedRect.Left; new_x = $newRect.Left
            visible_right_edge = $clientRight
            protected_affinity = $protectedAffinity; restored_affinity = $affinity
        } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'notch-geometry.json') -Encoding UTF8
        if (!$protected -or !$restored) {
            throw "Windows did not apply and clear the display affinity. Protected: $protectedAffinity, restored: $affinity."
        }
        $geometryChecked = $true

        Find-Setting 'gap from the top edge'
        [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
        Start-Sleep -Seconds 2

        Find-Setting 'launch at login'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        $runKey = 'HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run'
        $startupCommand = [Microsoft.Win32.Registry]::GetValue($runKey, 'Poni Rebuild', $null)
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        $startupAfterDisable = [Microsoft.Win32.Registry]::GetValue($runKey, 'Poni Rebuild', $null)
        if ($startupCommand -ne ('"{0}"' -f $exe) -or $null -ne $startupAfterDisable) {
            throw 'Launch at login did not enable and disable the expected Windows startup entry.'
        }
        @{ registered = $true; removed = $true } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'startup-settings.json') -Encoding UTF8

        Find-Setting 'warmer colors at night'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Find-Setting 'night warmth strength'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Milliseconds 750
        Save-Screen 'settings-notch-warmth.png'

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
        $savedSettings = Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json
        if (!$savedSettings.settings.panel.warm_night -or $savedSettings.settings.panel.warmth -ne 100) {
            throw 'The night warmth controls did not save the enabled state and strength.'
        }
        $screenTime = $savedSettings.screen_time
        if ($screenTime.idle_seconds -ne 600 -or @($screenTime.excluded_apps) -notcontains 'notepad.exe') {
            throw 'Screen Time did not save the idle limit and excluded executable.'
        }
        $screenTimeChecked = $true

        Find-Setting 'keep deleted tasks in trash'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Save-Screen 'settings-todo.png'
        Find-Setting 'remind me at bedtime'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Find-Setting 'chime even in do not disturb'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Save-Screen 'settings-day-progress.png'

        Find-Setting 'focus sessions before a long break'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'add remove countdown'
        [System.Windows.Forms.SendKeys]::SendWait('35{ENTER}')
        Start-Sleep -Seconds 2
        Find-Setting 'start a break after the timer'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Find-Setting 'keep playing in breaks'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Find-Setting 'completion sound'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        # Select the sound last because WebView2's native menu can consume the next mouse click.
        Find-Setting 'pomodoro background audio noise'
        [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
        Start-Sleep -Seconds 2
        [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
        Save-Screen 'settings-pomodoro.png'

        $profile = Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json
        $observed = @{
            cycle_length = $profile.pomodoro.settings.cycle_length
            preset_saved = @($profile.settings.timer_presets) -contains 35
            timer_then_break = $profile.settings.timer_then_break
            focus_sound = $profile.pomodoro.settings.focus_sound
            focus_sound_breaks = $profile.pomodoro.settings.focus_sound_breaks
            completion_sound_off = ($profile.pomodoro.settings.completion_sound -eq $false)
        }
        $observed | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'pomodoro-settings.json') -Encoding UTF8
        if ($observed.cycle_length -ne 8 -or !$observed.preset_saved -or !$observed.timer_then_break -or
            $observed.focus_sound -ne 'white' -or !$observed.focus_sound_breaks -or !$observed.completion_sound_off) {
            throw ('Unexpected Pomodoro settings after native input: ' + ($observed | ConvertTo-Json -Compress))
        }
        if ($profile.settings.todo.trash_days -ne 30) { throw 'Todo Trash retention did not save from Settings.' }
        if (!$profile.settings.bedtime_reminder -or !$profile.settings.bedtime_chime_dnd) {
            throw 'Bedtime reminder and chime settings did not save.'
        }
        $pomodoroChecked = $true

        Find-Setting 'water goal'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'movement breaks daily target'
        [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
        Start-Sleep -Seconds 2
        Find-Setting 'mindful minutes goal'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'eye break length'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'remind me to drink water'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Find-Setting 'eye break every'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Save-Screen 'settings-health.png'
        $health = (Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json).settings.health
        $health | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'health-settings.json') -Encoding UTF8
        if ($health.water_goal -ne 16 -or $health.break_goal -ne 1 -or
            $health.mindful_goal -ne 30 -or $health.eye_duration -ne 60 -or
            !$health.water_reminders -or $health.eye_interval -ne 60) {
            throw ('Unexpected Health settings after native input: ' + ($health | ConvertTo-Json -Compress))
        }
        Find-Setting 'low battery warning at'
        [System.Windows.Forms.SendKeys]::SendWait('{END}')
        Start-Sleep -Seconds 2
        Find-Setting 'battery level persentase'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Save-Screen 'settings-battery.png'
        $battery = (Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json).settings.battery
        $battery | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'battery-settings.json') -Encoding UTF8
        if ($battery.low_threshold -ne 50 -or !$battery.show_percentage) {
            throw ('Unexpected Battery settings after native input: ' + ($battery | ConvertTo-Json -Compress))
        }
        Find-Setting 'rotate between activities'
        [System.Windows.Forms.SendKeys]::SendWait(' ')
        Start-Sleep -Seconds 2
        Save-Screen 'settings-live-activities.png'
        $live = (Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json).settings.live
        $live | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'live-activity-settings.json') -Encoding UTF8
        if ($live.rotate -ne $false -or !$live.enabled -or !$live.timers) {
            throw ('Unexpected Live Activities settings after native input: ' + ($live | ConvertTo-Json -Compress))
        }
    }
    [CursorPosition]::PostMessage($settingsHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Seconds 2
    if ($process.HasExited -or [CursorPosition]::FindWindowByTitle('Poni Settings') -ne [IntPtr]::Zero) {
        throw 'Closing Settings did not leave the notch running independently.'
    }
    $observedPid = $process.Id
    $todoChecked = $false
    if ($bounds.Width -eq 1024 -and $bounds.Height -eq 768) {
        # Reopen the fixture profile with an eligible overdue task, a due task that
        # overrides auto-completion, and an expired Trash entry.
        Stop-Process -Id $process.Id -Force
        if (!$process.WaitForExit(5000)) { throw 'Could not close the application before the Todo restart.' }
        $seed = Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json -AsHashtable
        $seed.settings.panel.top_gap = 0
        $seed.settings.panel.position = 50
        $seed.settings.panel.width = 200
        $seed.settings.default_module = 'health'
        $seed.settings.health.eye_duration = 20
        $seed.settings.todo.late_minutes = 3
        $seed.settings.todo.snooze_minutes = 15
        $localNow = [DateTimeOffset]::Now
        $bedAt = $localNow.AddMinutes(1).AddSeconds(-$localNow.Second).AddMilliseconds(-$localNow.Millisecond)
        if (($bedAt - $localNow).TotalSeconds -lt 45) { $bedAt = $bedAt.AddMinutes(1) }
        $seed.bed_minute = $bedAt.Hour * 60 + $bedAt.Minute
        $seed.bedtime_notified_at_ms = $null
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $seed.timer = @{
            total_ms = 60000; remaining_ms = 60000; ends_at_ms = $now + 18000
            last_started_minutes = 1
        }
        $snoozeId = [Guid]::NewGuid().ToString()
        $lateId = [Guid]::NewGuid().ToString()
        $seed.tasks = @(
            @{ id = $snoozeId; text = 'Snooze this task'; done = $false; due_at_ms = $now - 60000; late_minutes = 0 }
            @{ id = $lateId; text = 'Late task'; done = $false; due_at_ms = $now - 600000 }
        )
        $seed.trashed_tasks = @(
            @{ deleted_at_ms = $now - 3456000000; task = @{ id = [Guid]::NewGuid().ToString(); text = 'Expired'; done = $false } }
        )
        $seed | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $dataPath -Encoding utf8
        [CursorPosition]::SetCursorPos(10, 740) | Out-Null
        $process = Start-Process -FilePath $exe -PassThru
        Start-Sleep -Seconds 15
        $process.Refresh()
        $todoWindow = $process.MainWindowHandle
        $todoClient = [CursorPosition+Rect]::new()
        $todoOrigin = [CursorPosition+Point]::new()
        if (![CursorPosition]::GetClientRect($todoWindow, [ref]$todoClient) -or
            ![CursorPosition]::ClientToScreen($todoWindow, [ref]$todoOrigin) -or $todoClient.Bottom -lt 76) {
            throw 'Todo reminder did not expand the closed notch.'
        }
        Save-Screen 'todo-due.png'
        Click-Point ($todoOrigin.X + $todoClient.Right - 30) ($todoOrigin.Y + 54)
        Start-Sleep -Seconds 3
        Save-Screen 'todo-snoozed.png'
        $updated = Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json
        $lateTask = $updated.tasks | Where-Object id -eq $lateId
        $snoozed = $updated.tasks | Where-Object id -eq $snoozeId
        $remaining = [int64]$snoozed.due_at_ms - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $todoResult = @{
            auto_completed = [bool]($lateTask.done -and $lateTask.auto_done)
            override_preserved = [bool](!$snoozed.done -and $snoozed.late_minutes -eq 0)
            snoozed_for_fifteen_minutes = [bool]($remaining -gt 885000 -and $remaining -le 900000)
            expired_trash_removed = @($updated.trashed_tasks).Count -eq 0
            retention_days_saved = $updated.settings.todo.trash_days
        }
        $todoResult | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'todo-observation.json') -Encoding UTF8
        if (!$todoResult.auto_completed -or !$todoResult.override_preserved -or
            !$todoResult.snoozed_for_fifteen_minutes -or !$todoResult.expired_trash_removed) {
            throw ('Unexpected Todo state after restart: ' + ($todoResult | ConvertTo-Json -Compress))
        }
        $todoChecked = $true

        $timerUntil = [DateTimeOffset]::UtcNow.AddSeconds(24)
        do {
            $updated = Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json
            $timerVisible = $updated.timer.notice_until_ms -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -and
                [CursorPosition]::GetClientRect($todoWindow, [ref]$todoClient) -and $todoClient.Bottom -ge 76
            if ($timerVisible) { break }
            Start-Sleep -Milliseconds 500
        } while ([DateTimeOffset]::UtcNow -lt $timerUntil)
        if (!$timerVisible) { throw 'The completed Timer did not show its notch actions.' }
        Start-Sleep -Milliseconds 750
        Save-Screen 'timer-completed.png'
        $todoOrigin = [CursorPosition+Point]::new()
        if (![CursorPosition]::ClientToScreen($todoWindow, [ref]$todoOrigin)) { throw 'Could not locate the Timer actions.' }
        Click-Point ($todoOrigin.X + $todoClient.Right - 77) ($todoOrigin.Y + 54)
        Start-Sleep -Seconds 2
        $updated = Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json
        $remaining = [int64]$updated.timer.ends_at_ms - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        Save-Screen 'timer-after-extension.png'
        $timerResult = @{
            remaining_ms = $remaining
            last_started_minutes = $updated.timer.last_started_minutes
            notice_cleared = $null -eq $updated.timer.notice_until_ms
        }
        if ($remaining -lt 290000 -or $remaining -gt 300000 -or $updated.timer.last_started_minutes -ne 1 -or
            $null -ne $updated.timer.notice_until_ms) {
            throw ('Unexpected Timer state after extension: ' + ($timerResult | ConvertTo-Json -Compress))
        }
        @{ extended_five_minutes = $true; last_preset_preserved = $true } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'timer-observation.json') -Encoding UTF8

        $bedCheckUntil = [DateTimeOffset]::UtcNow.AddSeconds(115)
        $bedtimeChecked = $false
        do {
            $updated = Get-Content -Raw -LiteralPath $dataPath | ConvertFrom-Json
            if ($updated.bedtime_notified_at_ms -ge $bedAt.ToUnixTimeMilliseconds() -and
                [CursorPosition]::GetClientRect($todoWindow, [ref]$todoClient) -and $todoClient.Bottom -ge 76) {
                $bedtimeChecked = $true
                break
            }
            Start-Sleep -Seconds 1
        } while ([DateTimeOffset]::UtcNow -lt $bedCheckUntil)
        if (!$bedtimeChecked) { throw 'The scheduled bedtime reminder did not appear on the notch.' }
        Save-Screen 'bedtime-reminder.png'
        $bedOrigin = [CursorPosition+Point]::new()
        if (![CursorPosition]::ClientToScreen($todoWindow, [ref]$bedOrigin)) { throw 'Could not locate the bedtime reminder.' }
        Click-Point ($bedOrigin.X + $todoClient.Right - 90) ($bedOrigin.Y + 54)
        Start-Sleep -Seconds 2
        if (![CursorPosition]::GetClientRect($todoWindow, [ref]$todoClient) -or $todoClient.Bottom -ge 76) {
            throw 'The bedtime reminder did not close after acknowledgement.'
        }
        @{ reminder_appeared = $true; acknowledged = $true } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'bedtime-observation.json') -Encoding UTF8

        [CursorPosition]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
        [CursorPosition]::keybd_event(0x4E, 0, 0, [UIntPtr]::Zero)
        [CursorPosition]::keybd_event(0x4E, 0, 2, [UIntPtr]::Zero)
        [CursorPosition]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
        Start-Sleep -Seconds 3
        $todoOrigin = [CursorPosition+Point]::new()
        if (![CursorPosition]::GetClientRect($todoWindow, [ref]$todoClient) -or
            ![CursorPosition]::ClientToScreen($todoWindow, [ref]$todoOrigin) -or $todoClient.Bottom -lt 220) {
            throw 'The Health panel did not open for the manual eye break.'
        }
        Save-Screen 'health-panel.png'
        Click-Point ($todoOrigin.X + 330) ($todoOrigin.Y + 104)
        $eyeDeadline = [DateTimeOffset]::UtcNow.AddSeconds(8)
        do {
            $eyeWindow = [CursorPosition]::FindWindowByTitle('Poni Eye Break')
            if ($eyeWindow -ne [IntPtr]::Zero) { break }
            Start-Sleep -Milliseconds 300
        } while ([DateTimeOffset]::UtcNow -lt $eyeDeadline)
        $eyeRect = [CursorPosition+Rect]::new()
        if ($eyeWindow -eq [IntPtr]::Zero -or
            ![CursorPosition]::GetClientRect($eyeWindow, [ref]$eyeRect) -or
            $eyeRect.Right -lt $bounds.Width -or $eyeRect.Bottom -lt $bounds.Height) {
            throw 'The manual eye break did not cover the runner display.'
        }
        Start-Sleep -Seconds 2
        Save-Screen 'eye-break-overlay.png'
        [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
        Start-Sleep -Seconds 2
        if ([CursorPosition]::FindWindowByTitle('Poni Eye Break') -ne [IntPtr]::Zero) {
            throw 'Escape did not dismiss the eye break.'
        }
        @{ covered_display = $true; dismissed_with_escape = $true } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'eye-break-observation.json') -Encoding UTF8
    }
    @{ process_id = $observedPid; main_window_handle = $mainHandle.ToInt64(); screenshot = 'desktop.png'; width_after_shortcut = $windowWidth; module_height = $moduleHeight; settings_width = $settingsWidth; settings_window_handle = $settingsHandle.ToInt64(); settings_closed_independently = $true; geometry_checked = $geometryChecked; screen_time_saved = $screenTimeChecked; pomodoro_saved = $pomodoroChecked; todo_checked = $todoChecked; weather_attempted = ($bounds.Width -eq 1024 -and $bounds.Height -eq 768) } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir 'observation.json') -Encoding UTF8
} finally {
    if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
