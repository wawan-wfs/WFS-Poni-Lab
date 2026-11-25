param([IntPtr]$Notch, [string]$DataPath, [string]$OutputDir)

$ErrorActionPreference = 'Stop'
$fixtureDirectory = Join-Path $env:RUNNER_TEMP 'poni-shelf-fixture'
New-Item -ItemType Directory -Force -Path $fixtureDirectory | Out-Null
$example = Join-Path $fixtureDirectory 'Shelf example.txt'
$received = Join-Path $fixtureDirectory 'received.txt'
$fixtureScript = Join-Path $fixtureDirectory 'fixture.ps1'
'Poni Shelf test fixture' | Set-Content -LiteralPath $example -Encoding utf8
@'
param([string]$Example, [string]$Received)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = [System.Windows.Forms.Form]::new()
$form.StartPosition = 'Manual'
$form.Location = [System.Drawing.Point]::new(40, 310)
$form.ClientSize = [System.Drawing.Size]::new(225, 145)
$form.Text = 'Poni Shelf test source'
$source = [System.Windows.Forms.Label]::new()
$source.SetBounds(5, 5, 215, 55)
$source.Text = 'Drag the example file to Poni'
$source.BackColor = [System.Drawing.Color]::LightSteelBlue
$source.Add_MouseDown({
    param($sender, $event)
    if ($event.Button -ne 'Left') { return }
    $data = [System.Windows.Forms.DataObject]::new()
    $data.SetData([System.Windows.Forms.DataFormats]::FileDrop, [string[]]@($Example))
    [void]$sender.DoDragDrop($data, [System.Windows.Forms.DragDropEffects]::Copy)
})
$target = [System.Windows.Forms.Label]::new()
$target.SetBounds(5, 70, 215, 65)
$target.Text = 'Drop from Poni here'
$target.BackColor = [System.Drawing.Color]::LightGreen
$target.AllowDrop = $true
$target.Add_DragEnter({
    param($sender, $event)
    if ($event.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
        $event.Effect = [System.Windows.Forms.DragDropEffects]::Copy
    }
})
$target.Add_DragDrop({
    param($sender, $event)
    $event.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop) |
        Set-Content -LiteralPath $Received -Encoding utf8
    $event.Effect = [System.Windows.Forms.DragDropEffects]::Copy
})
$form.Controls.Add($source)
$form.Controls.Add($target)
[void]$form.ShowDialog()
'@ | Set-Content -LiteralPath $fixtureScript -Encoding utf8

function Start-StaProcess([string[]]$Arguments) {
    $config = [Diagnostics.ProcessStartInfo]::new()
    $config.FileName = (Get-Command pwsh).Source
    $config.UseShellExecute = $false
    $config.CreateNoWindow = $true
    foreach ($argument in @('-NoProfile', '-Sta') + $Arguments) { $config.ArgumentList.Add($argument) }
    [Diagnostics.Process]::Start($config)
}

function Drag-ShelfPoint([int]$x, [int]$y, [int]$toX, [int]$toY) {
    [CursorPosition]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 250
    [CursorPosition]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    try {
        for ($step = 1; $step -le 22; $step++) {
            [CursorPosition]::SetCursorPos([int]($x + ($toX - $x) * $step / 22), [int]($y + ($toY - $y) * $step / 22)) | Out-Null
            Start-Sleep -Milliseconds 46
        }
        Start-Sleep -Milliseconds 800
    } finally {
        [CursorPosition]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    }
}

$panel = [CursorPosition+Rect]::new()
if (![CursorPosition]::GetClientRect($Notch, [ref]$panel)) { throw 'Cannot find the notch for the Shelf test.' }
if ($panel.Bottom -gt 130) {
    [CursorPosition]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [CursorPosition]::keybd_event(0x4E, 0, 0, [UIntPtr]::Zero)
    [CursorPosition]::keybd_event(0x4E, 0, 2, [UIntPtr]::Zero)
    [CursorPosition]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Seconds 1
}
$fixture = Start-StaProcess @('-File', $fixtureScript, '-Example', $example, '-Received', $received)
try {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(8)
    do {
        $source = [CursorPosition]::FindWindowByTitle('Poni Shelf test source')
        if ($source -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTimeOffset]::UtcNow -lt $deadline)

    $fileOrigin = [CursorPosition+Point]::new()
    $notchOrigin = [CursorPosition+Point]::new()
    if ($source -eq [IntPtr]::Zero -or $fixture.HasExited -or
        ![CursorPosition]::ClientToScreen($source, [ref]$fileOrigin) -or
        ![CursorPosition]::ClientToScreen($Notch, [ref]$notchOrigin) -or
        ![CursorPosition]::GetClientRect($Notch, [ref]$panel)) { throw 'Cannot locate the Shelf drop fixture.' }

    Drag-ShelfPoint ($fileOrigin.X + 85) ($fileOrigin.Y + 26) ($notchOrigin.X + [int]($panel.Right / 2)) ($notchOrigin.Y + 18)
    Start-Sleep -Seconds 2
    Save-Screen 'shelf-drop-in.png'
    $state = Get-Content -Raw -LiteralPath $DataPath | ConvertFrom-Json
    if (@($state.shelf.items | Where-Object path -eq $example).Count -ne 1) {
        throw 'The Shelf did not save the Windows file drop.'
    }

    $notchOrigin = [CursorPosition+Point]::new()
    if (![CursorPosition]::ClientToScreen($Notch, [ref]$notchOrigin)) { throw 'Cannot locate the Shelf card.' }
    Drag-ShelfPoint ($notchOrigin.X + 52) ($notchOrigin.Y + 110) ($fileOrigin.X + 85) ($fileOrigin.Y + 102)
    Start-Sleep -Seconds 2
    Save-Screen 'shelf-drag-out.png'
    $state = Get-Content -Raw -LiteralPath $DataPath | ConvertFrom-Json
    if (!(Test-Path -LiteralPath $received) -or (Get-Content -LiteralPath $received -Raw).Trim() -ne $example -or
        @($state.shelf.items).Count -ne 0 -or !(Test-Path -LiteralPath $example)) {
        throw 'A completed drag did not deliver the file and clear only its Shelf reference.'
    }
    @{ desktop_drop_in = $true; desktop_drag_out = $true; removed_reference_only = $true } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir 'shelf-observation.json') -Encoding UTF8
} finally {
    if (!$fixture.HasExited) { $fixture.Kill() }
}

$board = @'
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Clipboard]::SetText('Poni clipboard text fixture')
Start-Sleep -Seconds 2
$data = [Windows.Forms.DataObject]::new()
$data.SetData([Windows.Forms.DataFormats]::UnicodeText, 'Poni excluded clipboard fixture')
$data.SetData('ExcludeClipboardContentFromMonitorProcessing', 'true')
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
Start-Sleep -Seconds 2
$bitmap = [System.Drawing.Bitmap]::new(12, 8)
try { [System.Windows.Forms.Clipboard]::SetImage($bitmap) } finally { $bitmap.Dispose() }
Start-Sleep -Seconds 2
'@
$encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($board))
$boardProcess = Start-StaProcess @('-EncodedCommand', $encoded)
if (!$boardProcess.WaitForExit(14000) -or $boardProcess.ExitCode -ne 0) {
    if (!$boardProcess.HasExited) { $boardProcess.Kill() }
    throw 'The Windows clipboard fixture could not run.'
}
$clipPath = Join-Path (Split-Path -Parent $DataPath) 'clipboard.json'
$clips = @(Get-Content -Raw -LiteralPath $clipPath | ConvertFrom-Json)
$image = $clips | Where-Object { $_.kind -eq 'image' -and $_.width -eq 12 -and $_.height -eq 8 } | Select-Object -First 1
if (!$image -or @($clips | Where-Object text -eq 'Poni clipboard text fixture').Count -ne 1 -or
    @($clips | Where-Object text -eq 'Poni excluded clipboard fixture').Count -ne 0) {
    throw 'Clipboard history did not match the text, image, and excluded fixtures.'
}
@{ text_recorded = $true; image_recorded = $true; private_format_skipped = $true } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir 'clipboard-observation.json') -Encoding UTF8
