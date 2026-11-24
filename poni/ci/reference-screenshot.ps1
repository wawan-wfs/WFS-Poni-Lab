param([switch]$OpenSettings)

$ErrorActionPreference = 'Stop'
$outputDir = Join-Path $env:GITHUB_WORKSPACE 'reference-observation'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$compressed = Join-Path $env:GITHUB_WORKSPACE 'poni-reference/reference/poni.exe.gz'
$binary = Join-Path $env:RUNNER_TEMP 'poni-1.8.1-reference.exe'
$inputStream = [System.IO.File]::OpenRead($compressed)
try {
    $archive = [System.IO.Compression.GZipStream]::new($inputStream, [System.IO.Compression.CompressionMode]::Decompress)
    try {
        $output = [System.IO.File]::Create($binary)
        try { $archive.CopyTo($output) } finally { $output.Dispose() }
    } finally { $archive.Dispose() }
} finally { $inputStream.Dispose() }
$expectedSha = '8f3f62d41e11210c5524fda430aa12171bbe6e56b578db7ff5dbfc299e71eb43'
$actualSha = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha -ne $expectedSha) { throw 'The reference executable differs from the verified Poni 1.8.1 binary.' }
$appData = Join-Path $env:RUNNER_TEMP 'poni-observation-profile'
New-Item -ItemType Directory -Force -Path $appData | Out-Null
$env:APPDATA = $appData
$env:LOCALAPPDATA = Join-Path $appData 'Local'
New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA | Out-Null
$process = $null
$launchFailed = $false
$details = [ordered]@{
    executable_sha256 = $actualSha
    culture = (Get-Culture).Name
    timezone = (Get-TimeZone).Id
    operating_system = [System.Environment]::OSVersion.VersionString
    interactive_session = [System.Environment]::UserInteractive
    observations = @()
    screenshots = @()
    errors = @()
}

function Save-Desktop([string]$name) {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $image = [System.Drawing.Bitmap]::new($screen.Width, $screen.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    try {
        $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $image.Save((Join-Path $outputDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
        $details.screenshots += @{ file = $name; width = $screen.Width; height = $screen.Height }
    } finally {
        $graphics.Dispose()
        $image.Dispose()
    }
}

try {
    $process = Start-Process -FilePath $binary -PassThru
    Start-Sleep -Seconds 20
    $process.Refresh()
    $details.observations += @{
        stage = 'initial'
        process_id = $process.Id
        exited = $process.HasExited
        main_window_handle = if ($process.HasExited) { 0 } else { $process.MainWindowHandle.ToInt64() }
        main_window_title = if ($process.HasExited) { '' } else { $process.MainWindowTitle }
    }
    if ($process.HasExited) {
        $launchFailed = $true
        $details.errors += "Process exited before observation, exit code: $($process.ExitCode)"
    }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PoniPointer {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
        Save-Desktop '01-onboarding.png'
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        if ($screen.Width -eq 1024 -and $screen.Height -eq 768 -and !$process.HasExited) {
            # This position was observed on the 1024x768 first-run setup screenshot.
            [PoniPointer]::SetCursorPos(185, 686) | Out-Null
            [PoniPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
            [PoniPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Seconds 8
            Save-Desktop '02-after-defaults.png'
            [PoniPointer]::SetCursorPos(512, 15) | Out-Null
            Start-Sleep -Seconds 5
            Save-Desktop '03-hover.png'
            $details.observations += @{ stage = 'pointer-actions'; note = 'Clicked observed defaults link, then hovered near top centre; inspect screenshots to verify outcomes.' }
            if ($OpenSettings) {
                [PoniPointer]::SetCursorPos(821, 24) | Out-Null
                [PoniPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
                [PoniPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Seconds 5
                Save-Desktop '04-setup-final.png'
                # Finish first-run setup, then reopen the gear for the regular Settings pages.
                [PoniPointer]::SetCursorPos(842, 684) | Out-Null
                [PoniPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
                [PoniPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Seconds 2
                [PoniPointer]::SetCursorPos(512, 15) | Out-Null
                Start-Sleep -Seconds 3
                [PoniPointer]::SetCursorPos(821, 24) | Out-Null
                [PoniPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
                [PoniPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Seconds 4
                Save-Desktop '05-settings-general.png'
                Add-Type -AssemblyName UIAutomationClient
                Add-Type -AssemblyName UIAutomationTypes
                $root = [System.Windows.Automation.AutomationElement]::RootElement
                $processIdCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
                $windows = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, $processIdCondition))
                $details.observations += @{
                    stage = 'settings'
                    windows = @($windows | ForEach-Object { $_.Current.Name })
                }
                $settings = $windows | Where-Object { $_.Current.Name -match 'Settings' } | Select-Object -First 1
                if (!$settings) {
                    $details.errors += 'The Poni Settings window was not reported after clicking the gear.'
                } else {
                    $sections = @('Modules', 'Media', 'Calendar', 'Dock', 'Drop & clipboard', 'About')
                    $clickable = [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty, $true
                    )
                    $buttons = @($settings.FindAll([System.Windows.Automation.TreeScope]::Descendants, $clickable))
                    $details.observations += @{ stage = 'settings-controls'; buttons = @($buttons | ForEach-Object { $_.Current.Name }) }
                    # WebView2 on the runner may omit HTML buttons from UI Automation.
                    # These positions were observed in the 1024x768 General screenshot.
                    $visibleSidebar = @{ Modules = 263; Media = 572; Calendar = 606 }
                    foreach ($section in $sections) {
                        $item = $buttons | Where-Object { $_.Current.Name.Trim() -eq $section } | Select-Object -First 1
                        $invoke = $null
                        if ($item -and $item.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
                            $invoke.Invoke()
                        } elseif ($visibleSidebar.ContainsKey($section)) {
                            [PoniPointer]::SetCursorPos(144, $visibleSidebar[$section]) | Out-Null
                            [PoniPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
                            [PoniPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
                        } else {
                            continue
                        }
                        Start-Sleep -Milliseconds 750
                        $safeName = $section.ToLowerInvariant() -replace '[^a-z]+','-'
                        Save-Desktop "settings-$safeName.png"
                    }
                    # The original's search opens the first match when Enter is pressed.
                    # Use distinct labels for pages farther down the 1024x768 sidebar.
                    $settingsSearches = [ordered]@{
                        'notch-size' = 'expanded height tall modules'
                        'notch-closed-size' = 'corner curve'
                        'notch-opacity' = 'opacity when closed'
                        'notch-position' = 'gap from the top edge'
                        screentime = 'Track screen time'
                        'day-progress' = 'Remind me at bedtime'
                        battery = 'Low battery warning at'
                        health = 'Track health'
                        pomodoro = 'Focus sessions before a long break'
                        weather = 'Weather city celsius'
                        todo = 'Mark late tasks as done'
                        'live-activities' = 'Rotate between activities'
                        mirror = 'Show mirror'
                        notifications = 'Show Windows notifications in Poni'
                    }
                    foreach ($entry in $settingsSearches.GetEnumerator()) {
                        [PoniPointer]::SetCursorPos(144, 123) | Out-Null
                        [PoniPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
                        [PoniPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
                        [System.Windows.Forms.SendKeys]::SendWait('^a')
                        [System.Windows.Forms.SendKeys]::SendWait($entry.Value)
                        Start-Sleep -Milliseconds 250
                        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
                        Start-Sleep -Seconds 2
                        Save-Desktop "settings-$($entry.Key).png"
                    }
                }
            }
        } else {
            $details.errors += 'Pointer actions skipped because the expected desktop size or process was unavailable.'
        }
    } catch {
        $details.errors += "Desktop observation unavailable: $($_.Exception.Message)"
    }
} catch {
    $launchFailed = $true
    $details.errors += "Launch failed: $($_.Exception.Message)"
} finally {
    if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    $details | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDir 'observation.json') -Encoding UTF8
}

if ($details.errors.Count -gt 0) { $details.errors | ForEach-Object { Write-Warning $_ } }
if ($launchFailed -or $details.errors.Count -gt 0) { throw 'Reference capture was incomplete. See the observation artifact.' }
