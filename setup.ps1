$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Claude Scheduler.lnk")
$shortcut.TargetPath = "C:\Users\pinto\Documents\Cenas\auto\launcher.bat"
$shortcut.WorkingDirectory = "C:\Users\pinto\Documents\Cenas\auto"
$shortcut.Description = "Configure and schedule Claude Code automation"
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Host "Shortcut created: $env:USERPROFILE\Desktop\Claude Scheduler.lnk"
