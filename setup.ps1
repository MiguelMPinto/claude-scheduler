$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Claude Scheduler.lnk")
$shortcut.TargetPath = Join-Path $PSScriptRoot "launcher.bat"
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "Configure and schedule Claude Code automation"
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Host "Shortcut created: $env:USERPROFILE\Desktop\Claude Scheduler.lnk"
