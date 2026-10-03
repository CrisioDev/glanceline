# Glanceline – PowerPoint-Bridge
# Liest per COM die aktuelle Folie + Notizen aus der laufenden PowerPoint-Instanz
# und schreibt bei jeder Änderung eine JSON-Zeile auf stdout.
# Läuft unter Windows PowerShell 5.1 (GetActiveObject gibt es in PowerShell 7 nicht).
param([int]$ParentPid = 0)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Get-NotesText($slide) {
  try {
    foreach ($sh in $slide.NotesPage.Shapes.Placeholders) {
      # 2 = ppPlaceholderBody (das Notizfeld)
      if ($sh.PlaceholderFormat.Type -eq 2 -and $sh.HasTextFrame) {
        return [string]$sh.TextFrame.TextRange.Text
      }
    }
  } catch { }
  return ''
}

function Get-SlideTitle($slide) {
  try {
    if ($slide.Shapes.HasTitle) { return [string]$slide.Shapes.Title.TextFrame.TextRange.Text }
  } catch { }
  return ''
}

function Get-NextTitle($pres, [int]$index) {
  $count = $pres.Slides.Count
  for ($i = $index + 1; $i -le $count; $i++) {
    $next = $pres.Slides.Item($i)
    # -1 = msoTrue → ausgeblendete Folie überspringen
    if ($next.SlideShowTransition.Hidden -ne -1) {
      $t = Get-SlideTitle $next
      if (-not $t) { $t = "Folie $i" }
      return $t
    }
  }
  return ''
}

function Read-Slide($out, $pres, $slide) {
  $idx = [int]$slide.SlideIndex
  $out.slide = $idx
  $out.title = Get-SlideTitle $slide
  $out.notes = Get-NotesText $slide
  $out.nextTitle = Get-NextTitle $pres $idx
}

$last = ''
$tick = 0
while ($true) {
  $tick++
  if ($ParentPid -and ($tick % 20 -eq 0)) {
    if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  }

  $out = [ordered]@{ running = $false; mode = 'none' }
  $skip = $false
  $app = $null
  try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { $app = $null }

  if ($null -ne $app) {
    $out.running = $true
    try {
      if ($app.SlideShowWindows.Count -gt 0) {
        $ssw = $app.SlideShowWindows.Item(1)
        $view = $ssw.View
        $pres = $ssw.Presentation
        $out.file = [string]$pres.Name
        $out.total = [int]$pres.Slides.Count
        $state = [int]$view.State
        if ($state -eq 5) {
          # ppSlideShowDone – schwarzer „Ende der Bildschirmpräsentation“-Screen
          $out.mode = 'end'
        } else {
          $out.mode = 'show'
          $out.paused = ($state -ge 2 -and $state -le 4)
          Read-Slide $out $pres $view.Slide
        }
      } elseif ($app.Windows.Count -gt 0) {
        $win = $app.ActiveWindow
        $pres = $win.Presentation
        $out.mode = 'edit'
        $out.file = [string]$pres.Name
        $out.total = [int]$pres.Slides.Count
        $slide = $null
        try { $slide = $win.View.Slide } catch { }
        if ($null -eq $slide) { try { $slide = $win.Selection.SlideRange.Item(1) } catch { } }
        if ($null -ne $slide) { Read-Slide $out $pres $slide }
      }
    } catch {
      # PowerPoint ist beschäftigt (Dialog offen, Folie wird bearbeitet …) → letzten Stand behalten
      $skip = $true
    }
  }

  if (-not $skip) {
    $json = $out | ConvertTo-Json -Compress
    if ($json -ne $last) {
      [Console]::Out.WriteLine($json)
      [Console]::Out.Flush()
      $last = $json
    }
  }

  # COM-Referenzen sofort freigeben, sonst lässt sich PowerPoint nicht sauber schließen
  $app = $null; $ssw = $null; $view = $null; $pres = $null; $slide = $null; $win = $null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Start-Sleep -Milliseconds 250
}
