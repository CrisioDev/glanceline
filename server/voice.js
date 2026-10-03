'use strict';
// Sprachsteuerung: Modelle verwalten, Erkennung im Worker-Thread, Tracker auf dem Skript.
const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { norm, MULTI_LANGUAGES } = require('../public/voice-text');
const { spawn } = require('child_process');
const { VoiceTracker } = require('./voice-tracker');

// Kroko-Streaming-Modelle (Banafo, CC-BY-SA) über den sherpa-onnx-Spiegel auf Hugging Face
const MODELS = {
  de: 'sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06',
  en: 'sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06',
  fr: 'sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06',
  es: 'sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06',
};
const FILES = ['tokens.txt', 'decoder.onnx', 'joiner.onnx', 'encoder.onnx'];
// Mehrsprachig: NVIDIA Nemotron 3.5 ASR Streaming (OpenMDW-1.1) als sherpa-onnx-Export, 320-ms-Blöcke
const MULTI = {
  name: 'sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-320ms-int8-2026-06-11',
  files: ['tokens.txt', 'decoder.int8.onnx', 'joiner.int8.onnx', 'encoder.int8.onnx'],
};
const multiUrl = () => `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MULTI.name}.tar.bz2`;
const ALL_LANGUAGES = [...Object.keys(MODELS), ...MULTI_LANGUAGES];
// Modell zu einer Sprache bzw. zu einer Modell-ID ('de' … oder 'multi')
function modelInfo(langOrId) {
  if (MODELS[langOrId]) return { id: langOrId, name: MODELS[langOrId], files: FILES, multi: false };
  if (langOrId === 'multi' || MULTI_LANGUAGES.includes(langOrId)) return { id: 'multi', name: MULTI.name, files: MULTI.files, multi: true };
  return null;
}

const modelUrl = (name, file) => `https://huggingface.co/csukuangfj/${name}/resolve/main/${file}`;
// Im installierten Programm liegt der Worker entpackt neben app.asar
const WORKER = path.join(__dirname, 'voice-worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

class VoiceEngine extends EventEmitter {
  constructor({ dataDir }) {
    super();
    this.dir = path.join(dataDir, 'models');
    this.worker = null;
    this.loadedLang = null;
    this.tracker = new VoiceTracker();
    this.lang = 'de';
    this.status = { state: 'off', lang: '', progress: 0, error: '', pos: 0, words: 0, heard: '', installed: [] };
    this._refreshInstalled();
  }

  modelPath(lang) {
    const m = modelInfo(lang);
    return m ? path.join(this.dir, m.name) : '';
  }

  hasModel(lang) {
    const m = modelInfo(lang);
    return Boolean(m) && m.files.every((f) => fs.existsSync(path.join(this.dir, m.name, f)));
  }

  _refreshInstalled() {
    this.status.installed = [...Object.keys(MODELS), 'multi'].filter((id) => this.hasModel(id));
  }

  _set(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.status);
  }

  // Sprache wählen und – falls vorhanden – Modell laden
  async prepare(lang) {
    const model = modelInfo(lang);
    if (!model) {
      this._set({ state: 'error', error: 'voice.err.lang', lang });
      return false;
    }
    this.lang = lang;
    if (this.loadedLang === lang && this.worker) {
      this._set({ state: 'ready', lang, error: '' });
      return true;
    }
    if (!this.hasModel(lang)) {
      this._set({ state: 'missing', lang, error: '' });
      return false;
    }
    this._set({ state: 'loading', lang, error: '' });
    this._stopWorker();
    const worker = new Worker(WORKER);
    this.worker = worker;
    worker.on('message', (m) => this._onWorker(worker, m));
    worker.on('error', (e) => {
      if (this.worker !== worker) return;
      this._set({ state: 'error', error: e.message });
      this._stopWorker();
    });
    worker.postMessage({ type: 'load', dir: this.modelPath(lang), files: model.files, language: model.multi ? lang : '', threads: 2 });
    return true;
  }

  _onWorker(worker, m) {
    if (this.worker !== worker) return;
    if (m.type === 'ready') {
      this.loadedLang = this.lang;
      this._set({ state: 'ready', error: '' });
    } else if (m.type === 'text') {
      const heard = `${m.final} ${m.partial}`.trim();
      const words = heard.split(/\s+/).map((w) => norm(w, this.lang)).filter(Boolean);
      const pos = this.tracker.update(words);
      if (pos !== this.status.pos || heard !== this.status.heard) this._set({ pos, heard: heard.split(' ').slice(-12).join(' ') });
    } else if (m.type === 'error') {
      this._set({ state: 'error', error: m.error });
    }
  }

  _stopWorker() {
    if (this.worker) this.worker.terminate().catch(() => {});
    this.worker = null;
    this.loadedLang = null;
  }

  // Audio vom Prompter-Fenster (Float32, Mikrofon-Abtastrate)
  audio(samples, sampleRate) {
    if (this.worker && this.status.state === 'ready') this.worker.postMessage({ type: 'audio', samples, sampleRate });
  }

  setScript(words) {
    this.tracker.setWords(words);
    this._set({ words: words.length, pos: this.tracker.pos });
  }

  seek(pos) {
    this.tracker.seek(pos);
    if (this.worker) this.worker.postMessage({ type: 'reset' });
    this._set({ pos: this.tracker.pos, heard: '' });
  }

  stop() {
    this._stopWorker();
    this._set({ state: 'off', heard: '' });
  }

  // Modell herunterladen (je Datei mit Fortschritt; .part → umbenennen, damit Abbrüche nichts halb liegen lassen)
  async download(lang) {
    const model = modelInfo(lang);
    if (!model || this.status.state === 'downloading') return;
    if (model.multi) return this._downloadMulti(lang);
    const name = model.name;
    const dir = this.modelPath(lang);
    fs.mkdirSync(dir, { recursive: true });
    this._set({ state: 'downloading', lang, progress: 0, error: '' });
    try {
      const sizes = await Promise.all(
        FILES.map(async (f) => {
          const r = await fetch(modelUrl(name, f), { method: 'HEAD', redirect: 'follow' });
          return Number(r.headers.get('content-length')) || 0;
        }),
      );
      const total = sizes.reduce((a, b) => a + b, 0) || 1;
      let done = 0;
      for (const f of FILES) {
        const target = path.join(dir, f);
        if (fs.existsSync(target)) {
          done += fs.statSync(target).size;
          continue;
        }
        const res = await fetch(modelUrl(name, f), { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status} (${f})`);
        const part = `${target}.part`;
        const out = fs.createWriteStream(part);
        let lastEmit = 0;
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          done += chunk.length;
          if (Date.now() - lastEmit > 250) {
            lastEmit = Date.now();
            this._set({ progress: Math.min(0.99, done / total) });
          }
        }
        await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
        fs.renameSync(part, target);
      }
      this._refreshInstalled();
      this._set({ state: 'off', progress: 1 });
      this.emit('downloaded', lang);
    } catch (e) {
      this._set({ state: 'error', error: `voice.err.download|${e.message}` });
    }
  }

  // Mehrsprachenmodell: ein Archiv (~475 MB) laden und mit dem tar des Betriebssystems entpacken
  async _downloadMulti(lang) {
    fs.mkdirSync(this.dir, { recursive: true });
    const archive = path.join(this.dir, `${MULTI.name}.tar.bz2`);
    this._set({ state: 'downloading', lang, progress: 0, error: '' });
    try {
      if (!fs.existsSync(archive)) {
        const res = await fetch(multiUrl(), { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get('content-length')) || 475e6;
        const out = fs.createWriteStream(`${archive}.part`);
        let done = 0;
        let lastEmit = 0;
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          done += chunk.length;
          if (Date.now() - lastEmit > 250) {
            lastEmit = Date.now();
            this._set({ progress: Math.min(0.95, (done / total) * 0.95) });
          }
        }
        await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
        fs.renameSync(`${archive}.part`, archive);
      }
      this._set({ progress: 0.96 });
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      await new Promise((resolve, reject) => {
        const p = spawn(tar, ['-xjf', archive, '-C', this.dir], { windowsHide: true, stdio: 'ignore' });
        p.on('error', reject);
        p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar ${code}`))));
      });
      fs.rmSync(archive, { force: true });
      fs.rmSync(path.join(this.dir, MULTI.name, 'test_wavs'), { recursive: true, force: true });
      this._refreshInstalled();
      if (!this.hasModel('multi')) throw new Error('model files missing');
      this._set({ state: 'off', progress: 1 });
      this.emit('downloaded', lang);
    } catch (e) {
      this._set({ state: 'error', error: `voice.err.download|${e.message}` });
    }
  }

  deleteModel(lang) {
    const model = modelInfo(lang);
    if (!model) return;
    if (this.loadedLang && modelInfo(this.loadedLang).id === model.id) this.stop();
    fs.rmSync(path.join(this.dir, model.name), { recursive: true, force: true });
    this._refreshInstalled();
    this._set({});
  }
}

module.exports = { VoiceEngine, VOICE_LANGUAGES: ALL_LANGUAGES, modelInfo };
