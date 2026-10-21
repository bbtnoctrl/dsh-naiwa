param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [string]$LogPath = "",
  [int]$TimeoutMs = 8000,
  # Skip the WM_APP+3 path and use the synthetic double click (testing / stock builds).
  [switch]$PreferClick,
  # Only make sure the pet is running (used when DSH starts), do not trigger a laugh.
  [switch]$EnsureOnly
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message) {
  if ($LogPath) {
    try {
      [IO.File]::AppendAllText($LogPath, ("[" + (Get-Date -Format o) + "] " + $Message + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
    } catch {
      # logging must never break the trigger
    }
  }
}

Add-Type -Namespace Naiwa -Name Win -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@

$WM_LBUTTONDOWN = 0x0201
$WM_LBUTTONUP = 0x0202
$WM_LAUGH = 0x8003      # patched build only: WM_APP + 3
$WM_STATUS = 0x8002     # both builds: 0 idle, 1 hover, 2 laughing, 3 lying down
$title = 'NaiwaDesktop.Source.v1'

$hwnd = [Naiwa.Win]::FindWindow([NullString]::Value, $title)

if ($hwnd -eq [IntPtr]::Zero) {
  if (-not (Test-Path -LiteralPath $ExePath)) {
    Write-Log "exe not found: $ExePath"
    exit 2
  }
  Write-Log "pet not running, starting it"
  Start-Process -FilePath $ExePath | Out-Null
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline -and $hwnd -eq [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 200
    $hwnd = [Naiwa.Win]::FindWindow([NullString]::Value, $title)
  }
  if ($hwnd -ne [IntPtr]::Zero) { Start-Sleep -Milliseconds 800 }
}

if ($hwnd -eq [IntPtr]::Zero) {
  Write-Log "pet window did not appear"
  exit 3
}

# Startup mode: only make sure the pet is running, do not make it laugh.
if ($EnsureOnly) {
  Write-Log "pet is running"
  exit 0
}

# Path A: the patched build answers WM_APP+3 and laughs with auto-stand.
if (-not $PreferClick) {
  [Naiwa.Win]::PostMessage($hwnd, $WM_LAUGH, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 700
  $state = [int][Naiwa.Win]::SendMessage($hwnd, $WM_STATUS, [IntPtr]::Zero, [IntPtr]::Zero)
  if ($state -eq 2) {
    Write-Log "laughed via WM_APP+3"
    exit 0
  }
  Write-Log "WM_APP+3 gave no laugh (state=$state), falling back to synthetic click"
}

# Path B: stock build. Its double click is two quick left up/down pairs inside the window,
# detected by the pet itself (not WM_LBUTTONDBLCLK), so we post two pairs.
$rect = New-Object Naiwa.Win+RECT
[Naiwa.Win]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { $w = 244; $h = 312 }
$x = [int]($w * 0.5)
$y = [int]($h * 0.62)
$lparam = [IntPtr](($y -shl 16) -bor ($x -band 0xFFFF))

for ($i = 0; $i -lt 2; $i++) {
  [Naiwa.Win]::PostMessage($hwnd, $WM_LBUTTONDOWN, [IntPtr]1, $lparam) | Out-Null
  Start-Sleep -Milliseconds 25
  [Naiwa.Win]::PostMessage($hwnd, $WM_LBUTTONUP, [IntPtr]::Zero, $lparam) | Out-Null
  Start-Sleep -Milliseconds 90
}

Start-Sleep -Milliseconds 600
$state = [int][Naiwa.Win]::SendMessage($hwnd, $WM_STATUS, [IntPtr]::Zero, [IntPtr]::Zero)
if ($state -eq 2) {
  Write-Log "laughed via synthetic double-click (stock build)"

  # The stock build stays lying down after a laugh; its own single click stands it back up.
  # Wait out the 14s clip, then post one click so it is standing again.
  Start-Sleep -Seconds 15
  if ([Naiwa.Win]::FindWindow([NullString]::Value, $title) -ne [IntPtr]::Zero) {
    $hwnd = [Naiwa.Win]::FindWindow([NullString]::Value, $title)
    [Naiwa.Win]::PostMessage($hwnd, $WM_LBUTTONDOWN, [IntPtr]1, $lparam) | Out-Null
    Start-Sleep -Milliseconds 25
    [Naiwa.Win]::PostMessage($hwnd, $WM_LBUTTONUP, [IntPtr]::Zero, $lparam) | Out-Null
    Write-Log "posted stand-up click"
  }
  exit 0
}

Write-Log "trigger sent but state=$state"
exit 4
