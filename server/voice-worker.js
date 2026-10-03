'use strict';
// Spracherkennung in einem eigenen Thread – Modell laden (~3 s) und Dekodieren blockieren so nicht den Server.
const { parentPort } = require('worker_threads');
const path = require('path');

let sherpa = null;
let recognizer = null;
let stream = null;
let finalText = '';

function load(dir, threads, files, language) {
  const f = files || ['tokens.txt', 'decoder.onnx', 'joiner.onnx', 'encoder.onnx'];
  const pick = (prefix) => path.join(dir, f.find((x) => x.startsWith(prefix)));
  sherpa = sherpa || require('sherpa-onnx-node');
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: pick('encoder'),
        decoder: pick('decoder'),
        joiner: pick('joiner'),
      },
      tokens: pick('tokens'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 0.8,
    rule3MinUtteranceLength: 20,
  });
  stream = recognizer.createStream();
  // Mehrsprachenmodell: Sprache fest vorgeben statt automatisch erkennen
  if (language) stream.setOption('language', language);
  streamLanguage = language || '';
  finalText = '';
}
let streamLanguage = '';

parentPort.on('message', (msg) => {
  try {
    if (msg.type === 'load') {
      const t0 = Date.now();
      load(msg.dir, msg.threads || 2, msg.files, msg.language);
      parentPort.postMessage({ type: 'ready', ms: Date.now() - t0 });
    } else if (msg.type === 'audio' && recognizer) {
      // Mikrofon liefert meist 48 kHz – sherpa-onnx rechnet selbst auf 16 kHz um
      stream.acceptWaveform({ samples: msg.samples, sampleRate: msg.sampleRate });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      let text = recognizer.getResult(stream).text.trim();
      if (recognizer.isEndpoint(stream)) {
        if (text) finalText = `${finalText} ${text}`.trim().split(' ').slice(-60).join(' ');
        text = '';
        recognizer.reset(stream);
        if (streamLanguage) stream.setOption('language', streamLanguage);
      }
      parentPort.postMessage({ type: 'text', final: finalText, partial: text });
    } else if (msg.type === 'reset' && recognizer) {
      recognizer.reset(stream);
      if (streamLanguage) stream.setOption('language', streamLanguage);
      finalText = '';
    }
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: e.message });
  }
});
