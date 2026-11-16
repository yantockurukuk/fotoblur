/* ===================== PENGATURAN ===================== */
const CFG = {
  MUSIC_SRC: "fotokitablur.mp3",          // <- ganti nama lagu di sini (taruh di folder yang sama; kosongkan "" bila tanpa musik)
  MUSIC_VOLUME: 1.0,
  EMOJI: ["💖", "💕", "💗", "💘", "✨"],   // tambah / ganti emoji sesukamu
  SPEED: [80, 170],                // piksel/detik, naik
  LIFE: [2.2, 3.6],                // lama hidup emoji (detik)
  SPAWN: 9,                        // emoji baru per detik (turunkan = lebih sepi)
  MAX: 26,                         // maksimal emoji di layar (otomatis lebih sedikit di ponsel)
  SIZE: [32, 64],                  // ukuran emoji (px)
  SWAY: [4, 12],                   // goyang kiri-kanan (px)
  NEAR_HAND: 0.35,                 // peluang emoji muncul di sekitar tangan
  HOLD: 0.12, RELEASE: 0.35,       // debounce deteksi (detik)
  EXTEND: 1.15,                    // sensitivitas jari lurus
  MIN_CUTOFF: 1.2, BETA: 0.02,     // penghalus garis tangan
  BLUR_IN: 0.14, BLUR_OUT: 0.20,   // kecepatan blur masuk / keluar (detik)
  BLUR_PX: 0.007,                  // kekuatan blur (kali lebar layar, min 10 px, maks 26 px)
  TINT: 0,                      // kekuatan warna pink saat blur
  LINE: "rgb(100,200,255)", DOT: "#ffc0d9"
};
const MP_VER = "0.10.14";
const MP_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + MP_VER;
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
/* ====================================================== */

const $ = id => document.getElementById(id);
const video = $("cam"), cv = $("fx"), g = cv.getContext("2d"), tint = $("tint"), statusEl = $("status");
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/* ---- penghalus One Euro (unit 0-1000 agar sama di semua layar) ---- */
class OneEuro {
  constructor() { this.x = null; this.dx = null; }
  f(v, dt) {
    if (!this.x) { this.x = Float32Array.from(v); this.dx = new Float32Array(v.length); return this.x; }
    const ad = 1 / (1 + (1 / (2 * Math.PI)) / dt);
    for (let i = 0; i < v.length; i++) {
      this.dx[i] = ad * ((v[i] - this.x[i]) / dt) + (1 - ad) * this.dx[i];
      const c = CFG.MIN_CUTOFF + CFG.BETA * Math.abs(this.dx[i]);
      const a = 1 / (1 + (1 / (2 * Math.PI * c)) / dt);
      this.x[i] = a * v[i] + (1 - a) * this.x[i];
    }
    return this.x;
  }
}
const filters = {}, seen = {};

/* ---- sprite emoji (dirender sekali) ---- */
const sprites = [];
function buildSprites() {
  for (const ch of CFG.EMOJI) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d");
    x.font = '100px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(ch, 64, 70);
    sprites.push(c);
  }
}

/* ---- ukuran & pemetaan koordinat (video object-fit: cover, dicerminkan) ---- */
let cw = 0, ch = 0, dpr = 1;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cw = window.innerWidth; ch = window.innerHeight;
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
}
addEventListener("resize", resize);

let zoom = 1, mirror = true;
function mapPt(nx, ny, vw, vh) {   // nx, ny: 0..1000
  const s = Math.max(cw / vw, ch / vh);
  let x = (nx / 1000) * vw * s + (cw - vw * s) / 2;
  let y = (ny / 1000) * vh * s + (ch - vh * s) / 2;
  if (mirror) x = cw - x;
  return [cw / 2 + (x - cw / 2) * zoom, ch / 2 + (y - ch / 2) * zoom];
}

/* ---- emoji melayang ---- */
class Floater {
  constructor(x, y) {
    const k = clamp(ch / 720, 0.8, 1.5);
    this.sp = sprites[(Math.random() * sprites.length) | 0];
    this.size = rand(CFG.SIZE[0], CFG.SIZE[1]) * k;
    this.x = x; this.y = y;
    this.v = rand(CFG.SPEED[0], CFG.SPEED[1]) * k;
    this.vx = rand(-8, 8) * k;
    this.life = rand(CFG.LIFE[0], CFG.LIFE[1]);
    this.ph = rand(0, 6.283); this.fr = rand(1.2, 2.2);
    this.amp = rand(CFG.SWAY[0], CFG.SWAY[1]) * k;
    this.max = rand(0.8, 1); this.age = 0;
  }
  update(dt) {
    this.age += dt;
    this.y -= this.v * (0.75 + 0.25 * smooth(this.age)) * dt;
    this.x += this.vx * dt;
  }
  get dead() { return this.age >= this.life; }
  draw() {
    const a = this.max * smooth(this.age / 0.4) * smooth((this.life - this.age) / 0.9);
    if (a <= 0.01) return;
    const s = this.size * (0.55 + 0.45 * easeOut(this.age / 0.45));
    const cx = this.x + Math.sin(this.ph + this.age * this.fr) * this.amp;
    g.globalAlpha = a;
    g.drawImage(this.sp, cx - s / 2, this.y - s / 2, s, s);
  }
}

/* ---- deteksi 2 jari ---- */
function isPeace(lm, vw, vh) {
  const w = lm[0], d = (a, b) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
  const ext = (t, p) => d(lm[t], w) > d(lm[p], w) * CFG.EXTEND;
  return ext(8, 6) && ext(12, 10) && !ext(16, 14) && !ext(20, 18);
}

/* ---- musik ---- */
let audio = null, gain = null, AC = null, playing = false, starting = false, retryAt = 0;
let audioUnlocked = false, audioError = false;
function setupAudio() {
  if (!CFG.MUSIC_SRC || audio) return;
  audio = new Audio(CFG.MUSIC_SRC); audio.loop = true; audio.preload = "auto";
  audio.addEventListener("error", () => { audioError = true; });
  // WebAudio dipakai agar volume bisa diatur di iPhone. Dilewati bila dibuka dari file:// karena
  // Chrome menganggap file lokal "beda asal" lalu suaranya dibisukan. Lewat http(s) berjalan normal.
  if (location.protocol !== "file:") {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      const src = AC.createMediaElementSource(audio);
      gain = AC.createGain(); gain.gain.value = 0;
      src.connect(gain); gain.connect(AC.destination);
    } catch (e) { gain = null; AC = null; }
  }
  // browser mengizinkan suara setelah pengguna menyentuh / menekan sesuatu sekali
  const unlock = () => {
    audioUnlocked = true;
    if (AC) AC.resume();
    audio.play().then(() => { if (!playing) audio.pause(); }).catch(() => {});
  };
  ["pointerdown", "keydown", "touchstart"].forEach(ev => addEventListener(ev, unlock, { once: true, passive: true }));
}
const setVol = v => { if (gain) gain.gain.value = v; else if (audio) audio.volume = clamp(v, 0, 1); };

/* ---- model tangan ---- */
let landmarker = null, fellBack = false, makeLM = null;
async function loadModel() {
  const { HandLandmarker, FilesetResolver } = await import(MP_BASE + "/vision_bundle.mjs");
  const fileset = await FilesetResolver.forVisionTasks(MP_BASE + "/wasm");
  makeLM = d => HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: d },
    runningMode: "VIDEO", numHands: 1,
    minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6
  });
  try { landmarker = await makeLM("GPU"); } catch (e) { landmarker = await makeLM("CPU"); fellBack = true; }
}

/* ---- loop utama ---- */
let hands = [], prev = 0, lastVT = -1, active = false, detStart = null, lastDet = 0, level = 0, acc = 0;
let floaters = [];

function frame(t) {
  requestAnimationFrame(frame);
  const now = t / 1000, dt = clamp(now - prev, 1 / 240, 0.1); prev = now;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || video.readyState < 2) return;

  /* deteksi (hanya saat ada frame video baru) */
  if (video.currentTime !== lastVT && landmarker) {
    lastVT = video.currentTime;
    let res = null;
    try { res = landmarker.detectForVideo(video, performance.now()); }
    catch (e) { if (!fellBack) { fellBack = true; makeLM("CPU").then(l => landmarker = l); } }
    hands = [];
    if (res && res.landmarks) {
      const hd = res.handedness || res.handednesses || [];
      res.landmarks.forEach((lm, i) => {
        const key = (hd[i] && hd[i][0] && hd[i][0].categoryName) || i;
        const raw = new Float32Array(42);
        lm.forEach((p, j) => { raw[j * 2] = p.x * 1000; raw[j * 2 + 1] = p.y * 1000; });
        const f = filters[key] || (filters[key] = new OneEuro());
        seen[key] = now;
        hands.push({ pts: f.f(raw, dt), peace: isPeace(lm, vw, vh) });
      });
    }
    for (const k in seen) if (now - seen[k] > 0.3) { delete filters[k]; delete seen[k]; }
  }

  const peace = hands.find(h => h.peace);
  if (peace) {
    lastDet = now; if (detStart === null) detStart = now;
    if (!active && now - detStart >= CFG.HOLD) active = true;
  } else {
    detStart = null;
    if (active && now - lastDet >= CFG.RELEASE) active = false;
  }

  /* blur halus */
  const target = active ? 1 : 0, tau = target > level ? CFG.BLUR_IN : CFG.BLUR_OUT;
  level += (target - level) * (1 - Math.exp(-dt / tau));
  if (Math.abs(target - level) < 0.003) level = target;
  const e = smooth(level);
  zoom = 1 + 0.09 * e;                                   // sedikit diperbesar agar tepi blur tidak bolong
  video.style.filter = e > 0.005 ? "blur(" + (clamp(cw * CFG.BLUR_PX, 10, 26) * e).toFixed(2) + "px)" : "none";
  video.style.transform = "scaleX(" + (mirror ? -1 : 1) + ") scale(" + zoom.toFixed(4) + ")";
  tint.style.opacity = (CFG.TINT * e).toFixed(3);

  /* musik: mulai saat blur ON, volume mengikuti blur, berhenti setelah blur selesai */
  if (audio && !audioError) {
    if (active && !playing && !starting && now >= retryAt) {
      starting = true; setVol(0);
      audio.currentTime = 0;                              // selalu mulai dari awal lagu
      audio.play().then(() => { playing = true; })
        .catch(() => { retryAt = now + 0.5; })          // masih terkunci -> coba lagi sebentar lagi
        .finally(() => { starting = false; });
    }
    if (playing) {
      setVol(CFG.MUSIC_VOLUME * e);
      if (!active && level <= 0) { audio.pause(); audio.currentTime = 0; playing = false; }
    }
  }

  /* emoji */
  const maxN = cw < 600 ? Math.round(CFG.MAX * 0.6) : CFG.MAX;
  if (active) acc += CFG.SPAWN * (cw < 600 ? 0.7 : 1) * dt;
  while (acc >= 1) {
    acc -= 1;
    if (floaters.length >= maxN) continue;
    if (peace && Math.random() < CFG.NEAR_HAND) {
      const j = (Math.random() * 21) | 0;
      const [px, py] = mapPt(peace.pts[j * 2], peace.pts[j * 2 + 1], vw, vh);
      floaters.push(new Floater(px + rand(-35, 35), py + rand(-20, 40)));
    } else floaters.push(new Floater(rand(0, cw), rand(ch * 0.35, ch)));
  }

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  for (const f of floaters) { f.update(dt); f.draw(); }
  g.globalAlpha = 1;
  floaters = floaters.filter(f => !f.dead);

  /* garis tangan (tajam di atas blur) */
  g.lineWidth = 2.5; g.lineCap = "round";
  for (const h of hands) {
    const P = []; for (let j = 0; j < 21; j++) P.push(mapPt(h.pts[j * 2], h.pts[j * 2 + 1], vw, vh));
    g.strokeStyle = CFG.LINE; g.beginPath();
    for (const [a, b] of CONN) { g.moveTo(P[a][0], P[a][1]); g.lineTo(P[b][0], P[b][1]); }
    g.stroke();
    g.fillStyle = CFG.DOT;
    for (const p of P) { g.beginPath(); g.arc(p[0], p[1], 4, 0, 6.283); g.fill(); g.stroke(); }
  }

  const wantHint = audioError ? "⚠️ File musik tidak ditemukan: " + CFG.MUSIC_SRC
    : (audio && !audioUnlocked) ? "👆 Sentuh layar sekali jika musik tidak ada"
    : "Angkat 2 jari ✌️ untuk blur + love";
  if (wantHint !== hintTxt) { hintTxt = wantHint; $("hint").textContent = wantHint; }
  statusEl.textContent = now < camShownUntil ? "📷 " + camLabel : active ? "✌️ 2 jari terdeteksi · Blur ON" : hands.length ? "Tangan terdeteksi, angkat 2 jari" : "Angkat tangan ke kamera";
}

/* ---- kamera ---- */
let stream = null, camIds = [], camIdx = 0, started = false, hintTxt = "", camLabel = "", camShownUntil = 0;
const VIRTUAL = /droidcam|obs|virtual|iriun|epoccam|ivcam|manycam|snap camera|xsplit|camo|nvidia broadcast/i;

async function openCamera(deviceId) {
  if (stream) stream.getTracks().forEach(t => t.stop());
  const v = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = "user";
  stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
  const track = stream.getVideoTracks()[0], st = track.getSettings();
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");

  // kalau yang terbuka kamera virtual (DroidCam, OBS, dll) padahal ada kamera asli -> pindah ke kamera asli
  if (!deviceId && VIRTUAL.test(track.label)) {
    const real = devs.find(d => d.deviceId !== st.deviceId && !VIRTUAL.test(d.label));
    if (real) return openCamera(real.deviceId);
  }

  video.srcObject = stream; await video.play();
  lastVT = -1; hands = [];
  mirror = st.facingMode !== "environment";
  camIds = devs.map(d => d.deviceId);
  camIdx = Math.max(0, camIds.indexOf(st.deviceId));
  camLabel = track.label || "Kamera";
  camShownUntil = performance.now() / 1000 + 4;      // tampilkan nama kamera sebentar
  $("swap").hidden = camIds.length < 2;
}

$("swap").onclick = () => {
  camIdx = (camIdx + 1) % camIds.length;
  openCamera(camIds[camIdx]).catch(() => openCamera().catch(() => {}));
};

async function init() {
  const notice = $("notice"), msg = $("msg"), retry = $("retry");
  const fail = text => { msg.textContent = text; retry.hidden = false; notice.hidden = false; statusEl.textContent = "Kamera belum aktif"; };
  retry.hidden = true; notice.hidden = false; msg.textContent = "Memuat kamera dan model tangan…";

  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    return fail("Kamera hanya bisa dipakai lewat HTTPS (atau localhost). Buka halaman ini dari alamat https://.");

  setupAudio();
  try {
    await openCamera();
  } catch (err) {
    return fail(err && err.name === "NotAllowedError"
      ? "Izin kamera ditolak. Izinkan kamera di pengaturan browser, lalu tekan Coba lagi."
      : err && err.name === "NotFoundError"
        ? "Tidak ada kamera yang terdeteksi di perangkat ini. Sambungkan webcam, atau buka halaman ini dari ponsel."
        : "Kamera tidak bisa dibuka. Tutup aplikasi lain yang memakai kamera (Zoom, OBS, DroidCam), lalu tekan Coba lagi.");
  }
  try { if (!landmarker) await loadModel(); }
  catch (err) { return fail("Model gagal dimuat. Periksa koneksi internet, lalu tekan Coba lagi."); }

  if (!sprites.length) buildSprites();
  notice.hidden = true;
  if (!started) { started = true; requestAnimationFrame(t => { prev = t / 1000; frame(t); }); }
}
$("retry").onclick = init;
resize();
init();
