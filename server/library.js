'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { EventEmitter } = require('events');
const { docxToScript } = require('../public/docx');

// Skript-Ordner: Markdown-, Text- und Word-Dateien eines Ordners erscheinen als Skripte und
// bleiben live synchron – bearbeitet wird im eigenen Editor (Obsidian, VS Code, Word …).
const EXT = new Set(['.md', '.markdown', '.txt', '.docx']);
const MAX_BYTES = 5 * 1024 * 1024;
const POLL_MS = 30 * 1000; // Rückfall, falls das Dateisystem keine Änderungen meldet (Netzlaufwerke)

class ScriptFolder extends EventEmitter {
  constructor() {
    super();
    this.dir = '';
    this.watcher = null;
    this.status = { folder: '', files: 0, error: '' };
  }

  watch(dir) {
    this.stop();
    this.dir = dir ? path.resolve(dir) : '';
    if (!this.dir) {
      this._status({ folder: '', files: 0, error: '' });
      this.emit('files', []);
      return;
    }
    this._status({ folder: this.dir, error: '' });
    try {
      this.watcher = fs.watch(this.dir, () => this._schedule());
      this.watcher.on('error', () => this._schedule());
    } catch (e) {
      this._status({ error: e.code === 'ENOENT' ? 'err.folder.missing' : e.message });
    }
    this.poll = setInterval(() => this.scan(), POLL_MS);
    this.scan();
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.poll);
    try { this.watcher && this.watcher.close(); } catch { /* egal */ }
    this.watcher = null;
  }

  _status(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  _schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.scan(), 300); // Editoren speichern oft in mehreren Schritten
  }

  async scan() {
    const dir = this.dir;
    if (!dir) return;
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch (e) {
      // Ordner (vorübergehend) weg: Skripte behalten, nur melden
      this._status({ files: 0, error: e.code === 'ENOENT' ? 'err.folder.missing' : e.message });
      return;
    }
    const files = [];
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      const ext = path.extname(name).toLowerCase();
      if (!EXT.has(ext) || name.startsWith('~$') || name.startsWith('.')) continue; // ~$ = Word-Sperrdatei
      const file = path.join(dir, name);
      try {
        const st = await fs.promises.stat(file);
        if (!st.isFile() || st.size > MAX_BYTES) continue;
        const buf = await fs.promises.readFile(file);
        const body = ext === '.docx' ? await docxToScript(buf, (d) => zlib.inflateRawSync(d)) : buf.toString('utf8').replace(/^﻿/, '');
        files.push({ file, title: path.basename(name, path.extname(name)), body, mtime: st.mtimeMs });
      } catch {
        // halb gespeicherte Datei – beim nächsten Durchlauf erneut
      }
    }
    if (dir !== this.dir) return;
    this._status({ files: files.length, error: '' });
    this.emit('files', files);
  }
}

module.exports = { ScriptFolder };
