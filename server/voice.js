'use strict';
// Sprachsteuerung: Modelle verwalten, Erkennung im Worker-Thread, Tracker auf dem Skript.
const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { norm } = require('../public/voice-text');
const { VoiceTracker } = require('./voice-tracker');

// Kroko-Streaming-Modelle (Banafo, CC-BY-SA) über den sherpa-onnx-Spiegel auf Hugging Face
const MODELS = {
  de: 'sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06',
  en: 'sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06',
  fr: 'sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06',
  es: 'sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06',
};
const FILES = ['tokens.txt', 'decoder.onnx', 'joiner.onnx', 'encoder.onnx'];
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
    return path.join(this.dir, MODELS[lang]);
  }

  hasModel(lang) {
    return Boolean(MODELS[lang]) && FILES.every((f) => fs.existsSync(path.join(this.modelPath(lang), f)));
  }

  _refreshInstalled() {
    this.status.installed = Object.keys(MODELS).filter((l) => this.hasModel(l));
  }

  _set(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.status);
  }

  // Sprache wählen und – falls vorhanden – Modell laden
  async prepare(lang) {
    if (!MODELS[lang]) {
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
    worker.postMessage({ type: 'load', dir: this.modelPath(lang), threads: 2 });
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
    if (!MODELS[lang] || this.status.state === 'downloading') return;
    const name = MODELS[lang];
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

  deleteModel(lang) {
    if (!MODELS[lang]) return;
    if (this.loadedLang === lang) this.stop();
    fs.rmSync(this.modelPath(lang), { recursive: true, force: true });
    this._refreshInstalled();
    this._set({});
  }
}

module.exports = { VoiceEngine, VOICE_LANGUAGES: Object.keys(MODELS) };
