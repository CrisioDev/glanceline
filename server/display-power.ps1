# Prompter-Display in Windows ab- und wieder anmelden (wie „Diese Anzeige trennen“ in den Anzeigeeinstellungen).
# Aufruf: display-power.ps1 list | off <\\.\DISPLAYn> | on <\\.\DISPLAYn> <breite> <höhe> <x> <y> <hz>
# Ausgabe: eine Zeile JSON.
param([string]$cmd = 'list', [string]$device = '', [int]$width = 0, [int]$height = 0, [int]$x = 0, [int]$y = 0, [int]$hz = 0)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class GlDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields;
    public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, int i, ref DISPLAY_DEVICE dd, int flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, IntPtr dm, IntPtr hwnd, int flags, IntPtr param);

  const int ATTACHED = 0x1, PRIMARY = 0x4, MIRROR = 0x8;
  const int CURRENT = -1, REGISTRY = -2;
  const int DM_POSITION = 0x20, DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_FREQ = 0x400000;
  const int CDS_UPDATEREGISTRY = 0x1, CDS_NORESET = 0x10000000;

  static DEVMODE NewMode() { var m = new DEVMODE(); m.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); return m; }

  public static List<string> List() {
    var outList = new List<string>();
    var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(dd);
    for (int i = 0; EnumDisplayDevices(null, i, ref dd, 0); i++) {
      if ((dd.StateFlags & MIRROR) == 0) {
        var mon = new DISPLAY_DEVICE(); mon.cb = Marshal.SizeOf(mon);
        string monitor = EnumDisplayDevices(dd.DeviceName, 0, ref mon, 0) ? mon.DeviceString : "";
        if (monitor != "") {
          var m = NewMode();
          bool attached = (dd.StateFlags & ATTACHED) != 0;
          bool ok = EnumDisplaySettings(dd.DeviceName, attached ? CURRENT : REGISTRY, ref m);
          outList.Add(string.Format(
            "{{\"device\":\"{0}\",\"adapter\":\"{1}\",\"monitor\":\"{2}\",\"attached\":{3},\"primary\":{4},\"width\":{5},\"height\":{6},\"x\":{7},\"y\":{8},\"hz\":{9}}}",
            dd.DeviceName.Replace("\\", "\\\\"), Esc(dd.DeviceString), Esc(monitor), attached ? "true" : "false", (dd.StateFlags & PRIMARY) != 0 ? "true" : "false",
            ok ? m.dmPelsWidth : 0, ok ? m.dmPelsHeight : 0, ok ? m.dmPositionX : 0, ok ? m.dmPositionY : 0, ok ? m.dmDisplayFrequency : 0));
        }
      }
      dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(dd);
    }
    return outList;
  }

  static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }

  // Breite/Höhe 0 = Anzeige trennen. Erst in die Registry schreiben, dann alles auf einmal anwenden.
  public static int Set(string device, int w, int h, int x, int y, int hz) {
    var m = NewMode();
    m.dmDeviceName = device;
    m.dmPelsWidth = w; m.dmPelsHeight = h; m.dmPositionX = x; m.dmPositionY = y;
    m.dmFields = DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT;
    if (hz > 0) { m.dmDisplayFrequency = hz; m.dmFields |= DM_FREQ; }
    int r = ChangeDisplaySettingsEx(device, ref m, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_NORESET, IntPtr.Zero);
    if (r != 0) return r;
    return ChangeDisplaySettingsEx(null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
  }
}
'@

try {
  switch ($cmd) {
    'list' { '{"ok":true,"displays":[' + ([GlDisplay]::List() -join ',') + ']}' }
    'off' {
      if ($device -notmatch '^\\\\\.\\DISPLAY\d+$') { throw 'bad device' }
      $r = [GlDisplay]::Set($device, 0, 0, $x, $y, 0)
      '{"ok":' + ($(if ($r -eq 0) { 'true' } else { 'false' })) + ',"code":' + $r + '}'
    }
    'on' {
      if ($device -notmatch '^\\\\\.\\DISPLAY\d+$' -or $width -le 0 -or $height -le 0) { throw 'bad arguments' }
      $r = [GlDisplay]::Set($device, $width, $height, $x, $y, $hz)
      '{"ok":' + ($(if ($r -eq 0) { 'true' } else { 'false' })) + ',"code":' + $r + '}'
    }
    default { throw "unknown command $cmd" }
  }
} catch {
  '{"ok":false,"error":"' + ($_.Exception.Message -replace '\\', '\\' -replace '"', "'") + '"}'
}
