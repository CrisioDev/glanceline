'use strict';
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// Im installierten Programm liegt das Skript entpackt neben app.asar (PowerShell kann nicht ins Archiv)
const BRIDGE = path.join(__dirname, 'ppt-bridge.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// Startet die PowerShell-COM-Bridge und meldet jede Folien-/Notizänderung als 'update'.
class PowerPointWatcher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.stopped = true;
  }

  start() {
    if (process.platform !== 'win32') return;
    this.stopped = false;
    this._spawn();
  }

  _spawn() {
    if (this.stopped) return;
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BRIDGE, '-ParentPid', String(process.pid)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.proc = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let data;
      try { data = JSON.parse(line); } catch { return; }
      this.emit('update', data);
    });
    proc.stderr.on('data', (d) => this.emit('log', String(d).trim()));
    proc.on('error', (e) => this.emit('log', `PowerPoint-Bridge: ${e.message}`));
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      if (!this.stopped) setTimeout(() => this._spawn(), 3000);
    });
  }

  stop() {
    this.stopped = true;
    if (this.proc) {
      try { this.proc.kill(); } catch { /* egal */ }
      this.proc = null;
    }
  }
}

module.exports = { PowerPointWatcher };
