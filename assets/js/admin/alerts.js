// FB Menus admin — alert sounds (per device) and the app-icon badge.
// Sounds are synthesised with Web Audio (no files to download). They play
// while the app is open; closed-app notifications use the phone's own sound.

const KEY = 'fbm:alert';
export const SOUNDS = {
  chime:  'Chime',
  bell:   'Service bell',
  ding:   'Kitchen ding',
  double: 'Double beep',
  alarm:  'Urgent alarm',
  none:   'Silent',
};

export function getSettings() {
  try {
    return { sound: 'chime', volume: 0.8, repeat: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { sound: 'chime', volume: 0.8, repeat: true };
  }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

let ctx = null;
function audio() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// Browsers only allow sound after a tap: unlock on the first interaction.
['pointerdown', 'keydown', 'touchend'].forEach((ev) =>
  window.addEventListener(ev, () => { try { audio(); } catch { /* no audio */ } }, { once: true, passive: true }));

function tone(a, { freq, start = 0, dur = 0.2, type = 'sine', gain = 1, slideTo = null }, master) {
  const o = a.createOscillator();
  const g = a.createGain();
  const t0 = a.currentTime + start;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

const PATTERNS = {
  chime:  [{ freq: 1047, dur: .35 }, { freq: 1319, start: .15, dur: .35 }, { freq: 1568, start: .3, dur: .6 }],
  bell:   [{ freq: 1760, dur: 1.4, gain: .7 }, { freq: 880, dur: 1.4, gain: .5 }, { freq: 2637, dur: .7, gain: .25 }],
  ding:   [{ freq: 1319, dur: .7, type: 'triangle' }, { freq: 1319, start: .45, dur: .9, type: 'triangle' }],
  double: [{ freq: 1000, dur: .12, type: 'square', gain: .45 }, { freq: 1000, start: .2, dur: .12, type: 'square', gain: .45 }],
  alarm:  [0, .3, .6, .9].flatMap((s) => [
    { freq: 950, start: s, dur: .15, type: 'sawtooth', gain: .35 },
    { freq: 650, start: s + .15, dur: .15, type: 'sawtooth', gain: .35 }]),
};

export function play(sound = getSettings().sound, volume = getSettings().volume) {
  if (sound === 'none' || !PATTERNS[sound]) return;
  try {
    const a = audio();
    const master = a.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume));
    master.connect(a.destination);
    PATTERNS[sound].forEach((p) => tone(a, p, master));
    if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
  } catch { /* audio blocked until the first tap */ }
}

/** Number of open orders on the app icon (clears at 0). */
export function setBadge(n) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge();
  } catch { /* not supported */ }
}
