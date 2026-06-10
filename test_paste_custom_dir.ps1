# 1. Put image in clipboard
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 200, 200
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.Clear([System.Drawing.Color]::Blue)
$graphics.Dispose()
[System.Windows.Forms.Clipboard]::SetImage($bmp)
Write-Output "Image placed in clipboard."

# 2. Start Electron with logging, custom user data, no gpu, no sandbox
$logFile = "d:\DuAn\App-Assign tasks\electron_output.log"
if (Test-Path $logFile) { Remove-Item $logFile }
$errFile = "d:\DuAn\App-Assign tasks\electron_error.log"
if (Test-Path $errFile) { Remove-Item $errFile }

$customDir = "C:\Users\ASUS\AppData\Roaming\TeamFlowTest"
if (Test-Path $customDir) { Remove-Item -Recurse -Force $customDir -ErrorAction SilentlyContinue }

Write-Output "Starting Electron with custom user-data-dir..."
$process = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start", "--", "--enable-logging", "--user-data-dir=$customDir", "--disable-gpu", "--no-sandbox" -WorkingDirectory "d:\DuAn\App-Assign tasks\desktop" -PassThru -NoNewWindow -RedirectStandardOutput $logFile -RedirectStandardError $errFile

# Wait for Electron to run flow (35s)
Write-Output "Waiting for Electron to run flow (35s)..."
Start-Sleep -Seconds 35

# Kill Electron
Write-Output "Stopping Electron..."
Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force

# Read logs
Write-Output "--- ELECTRON LOGS ---"
if (Test-Path $logFile) {
    Get-Content $logFile
} else {
    Write-Output "No log file found."
}
