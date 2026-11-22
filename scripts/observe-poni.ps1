$ErrorActionPreference = 'Stop'
$outputDir = Join-Path $env:GITHUB_WORKSPACE 'observation'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$binary = Join-Path $env:GITHUB_WORKSPACE 'reference/poni.exe'
$appData = Join-Path $env:RUNNER_TEMP 'poni-observation-profile'
New-Item -ItemType Directory -Force -Path $appData | Out-Null
$env:APPDATA = $appData
$process = $null
$launchFailed = $false
$details = [ordered]@{
    executable_sha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
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
if ($launchFailed) { throw 'Poni did not remain running through observation. See the observation artifact.' }
