# Numpad listener for the DS3 Guide Numpad Controller.
# Watches a fixed set of numpad keys, even while the game is the focused window, and
# relays the matching action to the local controller. It does not read or store any
# other key; only the virtual-key codes in $MAP (plus capture) are polled.
#
#   8 nav-up    2 nav-down    5 toggle (tick)    4 chapter-prev    6 chapter-next
#   7 delete-shot    0 edit-toggle    9 capture (Steam F12 screenshot -> queue -> guide)
#
# Numpad 9 takes a Steam screenshot via the overlay (the only thing that can grab an
# exclusive-fullscreen frame), copies the resulting JPG into the queue, and tells the
# guide to upload it. Your keystrokes are never recorded.
param(
  [string]$ServerUrl = "http://127.0.0.1:10030",
  [string]$QueueDir  = "$PSScriptRoot\.queue",
  [string]$AppId     = "374320",   # Dark Souls III Steam app id
  [int]$ScreenshotVk = 0x7B        # F12 = default Steam screenshot key
)

New-Item -ItemType Directory -Force -Path $QueueDir | Out-Null

# Single-instance guard so stacked listeners do not fire each key twice.
$mutex = New-Object System.Threading.Mutex($false, "Global\DS3GuideNumpad")
try { $have = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $have = $true }
if (-not $have) { Write-Host "Another listener is already running -> exiting."; exit }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll")] public static extern short GetKeyState(int v);
  [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);
}
'@

# ----- Steam screenshot capture (works for exclusive fullscreen via the overlay) -----
function Get-SteamShotDirs {
  $steam = $null
  try { $steam = (Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -Name SteamPath -ErrorAction Stop).SteamPath } catch {}
  if (-not $steam -or -not (Test-Path $steam)) { $steam = 'C:\Program Files (x86)\Steam' }
  $dirs = @()
  $ud = Join-Path $steam 'userdata'
  if (Test-Path $ud) {
    foreach ($acc in (Get-ChildItem $ud -Directory -ErrorAction SilentlyContinue)) {
      $d = Join-Path $acc.FullName ("760\remote\{0}\screenshots" -f $AppId)
      if (Test-Path $d) { $dirs += $d }
    }
  }
  return $dirs
}
function Get-LatestShot($dirs) {
  $all = @()
  foreach ($d in $dirs) { $all += Get-ChildItem $d -Filter *.jpg -File -ErrorAction SilentlyContinue }
  return ($all | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
}
function Capture-Steam($dir, $dirs) {
  if (-not $dirs -or $dirs.Count -eq 0) {
    Write-Host "  no Steam screenshot folder for app $AppId yet - take ONE F12 shot in-game first, then it auto-detects."
    return $null
  }
  $prev = Get-LatestShot $dirs
  $beforeTime = if ($prev) { $prev.LastWriteTimeUtc } else { [datetime]::MinValue }
  [K]::keybd_event([byte]$ScreenshotVk, 0, 0, [UIntPtr]::Zero)   # press F12 so Steam grabs the frame
  Start-Sleep -Milliseconds 45
  [K]::keybd_event([byte]$ScreenshotVk, 0, 2, [UIntPtr]::Zero)
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 120
    $latest = Get-LatestShot $dirs
    if ($latest -and $latest.LastWriteTimeUtc -gt $beforeTime) {
      $name = "shot-" + (Get-Date -Format "yyyyMMdd-HHmmss-fff") + ".jpg"
      try { Copy-Item $latest.FullName (Join-Path $dir $name) -Force; [console]::beep(900, 90); return $name }
      catch { Write-Host "  copy failed: $_"; return $null }
    }
  }
  Write-Host "  no new Steam screenshot detected - is the Steam overlay enabled for DS3 and F12 the screenshot key?"
  return $null
}

function Post($body) {
  try { Invoke-RestMethod -Uri "$ServerUrl/api/key" -Method Post -Body ($body | ConvertTo-Json -Compress) -ContentType "application/json" -TimeoutSec 2 | Out-Null }
  catch {}
}

$MAP = @{
  0x68 = "nav-up";       # 8
  0x62 = "nav-down";     # 2
  0x65 = "toggle";       # 5
  0x64 = "chapter-prev"; # 4
  0x66 = "chapter-next"; # 6
  0x67 = "delete-shot";  # 7
  0x60 = "edit-toggle";  # 0
}
$CAPTURE_KEY = 0x69      # 9 -> Steam screenshot + submit to the highlighted step
$down = @{}

# Force Num Lock ON so the numpad emits VK_NUMPAD0-9 (0x60-0x69), not arrows / nav keys.
if (([K]::GetKeyState(0x90) -band 1) -eq 0) {
  [K]::keybd_event(0x90, 0x45, 0, [UIntPtr]::Zero)
  [K]::keybd_event(0x90, 0x45, 2, [UIntPtr]::Zero)
  Write-Host "  Num Lock was OFF -> forced ON"
}

$ShotDirs = Get-SteamShotDirs
if ($ShotDirs.Count -gt 0) { Write-Host "  Steam screenshots: $($ShotDirs -join ' ; ')" }
else { Write-Host "  Steam screenshot folder not found yet (take one F12 shot in DS3, then it appears)." }

Write-Host "Numpad listener active -> $ServerUrl"
Write-Host "  8/2 step | 5 tick | 4/6 chapter | 9 capture | 7 remove | 0 edit mode"

while ($true) {
  foreach ($vk in @($MAP.Keys + $CAPTURE_KEY)) {
    $pressed = ([K]::GetAsyncKeyState($vk) -band 0x8000) -ne 0
    if ($pressed -and -not $down[$vk]) {
      $down[$vk] = $true
      if ($vk -eq $CAPTURE_KEY) {
        if (-not $ShotDirs -or $ShotDirs.Count -eq 0) { $ShotDirs = Get-SteamShotDirs }   # retry detect
        $name = Capture-Steam $QueueDir $ShotDirs
        if ($name) { Post @{ action = "capture"; file = $name }; Write-Host "  capture -> $name" }
      } else {
        Post @{ action = $MAP[$vk] }
        Write-Host "  $($MAP[$vk])"
      }
    } elseif (-not $pressed) {
      $down[$vk] = $false
    }
  }
  Start-Sleep -Milliseconds 35
}
