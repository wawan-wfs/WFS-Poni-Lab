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
    screenshot = $null
    errors = @()
}

try {
    $process = Start-Process -FilePath $binary -PassThru
    Start-Sleep -Seconds 20
    $process.Refresh()
    $details.observations += @{
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
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $image = [System.Drawing.Bitmap]::new($screen.Width, $screen.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($image)
        try {
            $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
            $image.Save((Join-Path $outputDir 'desktop.png'), [System.Drawing.Imaging.ImageFormat]::Png)
            $details.screenshot = @{ file = 'desktop.png'; width = $screen.Width; height = $screen.Height }
        } finally {
            $graphics.Dispose()
            $image.Dispose()
        }
    } catch {
        $details.errors += "Screenshot unavailable: $($_.Exception.Message)"
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
