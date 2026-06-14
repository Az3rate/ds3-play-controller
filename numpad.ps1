# Numpad listener for the DS3 Guide Numpad Controller. Watches for exactly two keys,
# numpad 8 and numpad 2, even while the game is the focused window, and relays the
# matching action to the local controller. 8 = step up, 2 = step down.
# It does not read or store any other key; only these two virtual-key codes are polled.
param([string]$ServerUrl = "http://127.0.0.1:10030")

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll")] public static extern short GetKeyState(int v);
  [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);
}
'@

# Force Num Lock ON so the numpad emits VK_NUMPAD8/2 (0x68/0x62), not arrow keys.
if (([K]::GetKeyState(0x90) -band 1) -eq 0) {
  [K]::keybd_event(0x90, 0x45, 0, [UIntPtr]::Zero)
  [K]::keybd_event(0x90, 0x45, 2, [UIntPtr]::Zero)
  Write-Host "  Num Lock was OFF -> forced ON"
}

$MAP = @{ 0x68 = "nav-up"; 0x62 = "nav-down" }
$down = @{}
function Post($a) {
  try { Invoke-RestMethod -Uri "$ServerUrl/api/key" -Method Post -Body (@{ action = $a } | ConvertTo-Json -Compress) -ContentType "application/json" -TimeoutSec 2 | Out-Null }
  catch {}
}

Write-Host "Numpad listener active -> $ServerUrl   (8 = step up, 2 = step down)"
while ($true) {
  foreach ($vk in $MAP.Keys) {
    $pressed = ([K]::GetAsyncKeyState($vk) -band 0x8000) -ne 0
    if ($pressed -and -not $down[$vk]) { $down[$vk] = $true; Post $MAP[$vk]; Write-Host "  $($MAP[$vk])" }
    elseif (-not $pressed) { $down[$vk] = $false }
  }
  Start-Sleep -Milliseconds 35
}
