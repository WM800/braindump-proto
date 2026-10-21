// Piper TTS (VITS ONNX) running on-device: onnxruntime-web (wasm, single thread) + espeak-ng phonemizer (wasm).
// Contract used by home.html: default export {init(onProgress), speak(text, lang) -> async iterable of {audio:Float32Array, rate}}.
// Everything is fetched from this origin once and kept in the Cache API (works offline afterwards).
const BASE = new URL('./', import.meta.url).href, CACHE = 'bd-tts-v1';
const VOICES = {en: 'en_US-lessac-medium', pl: 'pl_PL-gosia-medium'};
let ort = null, phon = null, sess = {}, cfg = {};

async function getBuf(url, onP) {
  let c = null; try { c = await caches.open(CACHE); const hit = await c.match(url); if (hit) return await hit.arrayBuffer(); } catch (e) {}
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const total = +r.headers.get('Content-Length') || 0, rd = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (onP && total) onP(got / total); }
  const buf = await new Blob(parts).arrayBuffer();
  try { if (c) await c.put(url, new Response(buf.slice(0))); } catch (e) {}
  return buf;
}
async function loadVoice(lang, onP) {
  if (sess[lang]) return sess[lang];
  const id = VOICES[lang]; if (!id) throw new Error('no voice for ' + lang);
  const j = JSON.parse(new TextDecoder().decode(await getBuf(BASE + 'voices/' + id + '.onnx.json')));
  const model = await getBuf(BASE + 'voices/' + id + '.onnx', onP);
  cfg[lang] = j; sess[lang] = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  return sess[lang];
}
async function phonemize(sentences, voice) {
  const mod = await phon.createPiperPhonemize; const lines = [];
  const m = await mod({ print: d => lines.push(JSON.parse(d).phoneme_ids), printErr: () => {}, locateFile: u => u.endsWith('.wasm') ? BASE + 'piper_phonemize.wasm' : u.endsWith('.data') ? BASE + 'piper_phonemize.data' : u });
  m.callMain(['-l', voice, '--input', JSON.stringify(sentences.map(text => ({ text }))), '--espeak_data', '/espeak-ng-data']);
  return lines;
}
const split = t => (String(t).replace(/\s+/g, ' ').trim().match(/[^.!?…;:]+[.!?…;:]*/g) || []).map(s => s.trim()).filter(Boolean);

export default {
  async init(onP) {
    ort = (await import(BASE + 'ort/ort.wasm.min.js')); ort = ort.default || ort;
    ort.env.wasm.wasmPaths = BASE + 'ort/'; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    phon = { createPiperPhonemize: import(BASE + 'phonemize.js').then(m => m.createPiperPhonemize) };
    await loadVoice('en', onP);
    getBuf(BASE + 'piper_phonemize.data').catch(() => {}); // warm the cache
  },
  async *speak(text, lang) {
    if (!sess[lang]) await loadVoice(lang);
    const c = cfg[lang], s = sess[lang], sents = split(text); if (!sents.length) return;
    const ids = await phonemize(sents, c.espeak.voice);
    for (const p of ids) {
      const feeds = { input: new ort.Tensor('int64', p, [1, p.length]), input_lengths: new ort.Tensor('int64', [p.length]), scales: new ort.Tensor('float32', [c.inference.noise_scale, c.inference.length_scale, c.inference.noise_w]) };
      if (c.speaker_id_map && Object.keys(c.speaker_id_map).length) feeds.sid = new ort.Tensor('int64', [0]);
      const { output } = await s.run(feeds);
      yield { audio: output.data, rate: c.audio.sample_rate };
    }
  },
};
