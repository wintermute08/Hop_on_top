/**
 * 에셋 없는 WebAudio 합성 사운드.
 * - SFX: 점프/착지/휘두름/타격/리스폰/승리 — 오실레이터+노이즈로 즉석 합성.
 * - BGM: 가벼운 아르페지오 루프(로우패스 걸린 사각파, 아주 작게).
 * - 음소거는 localStorage에 저장 (앱인토스 심사 요구: 사운드 On/Off 제공).
 * 브라우저 정책상 첫 사용자 입력 후 unlock()이 호출돼야 소리가 난다.
 */

const MUTE_KEY = 'hop_muted';
const MASTER_VOL = 0.5;
const BGM_VOL = 0.05;

// BGM 음계 (A마이너 펜타토닉 아르페지오, Hz)
const BGM_NOTES = [220, 261.63, 329.63, 440, 329.63, 261.63, 220, 164.81];
const BGM_BASS = [110, 110, 87.31, 98];
const BGM_STEP = 0.28; // 한 음 길이(초)

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmTimer: number | null = null;
  private bgmNextTime = 0;
  private bgmStep = 0;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* 무시 */ }
  }

  /** 사용자 제스처 안에서 호출 — 컨텍스트 생성/재개 + BGM 시작 */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOL;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startBgm();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* 무시 */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_VOL, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  // ── SFX ──

  /** 점프 도약 — 위로 쓸어올리는 사각파 */
  jump(): void {
    this.sweep('square', 170, 340, 0.12, 0.16);
  }

  /** 착지 — 낮은 쿵 + 노이즈 퍽 */
  land(): void {
    this.thump(95, 0.09, 0.3);
    this.noiseBurst(0.05, 900, 0.12);
  }

  /** 펀치 휘두름 — 짧은 바람소리 */
  swing(): void {
    this.noiseBurst(0.07, 2200, 0.08);
  }

  /** 타격 명중 — juice(0~1)로 잽~크로스 무게 조절 */
  hit(juice: number): void {
    this.thump(70 - 20 * juice, 0.1 + 0.08 * juice, 0.5 + 0.3 * juice);
    this.noiseBurst(0.05 + 0.05 * juice, 1400, 0.3 + 0.2 * juice);
  }

  /** 함정/추락 리스폰 — 아래로 미끄러지는 톤 */
  respawn(): void {
    this.sweep('sawtooth', 330, 90, 0.28, 0.14);
  }

  /** 정상 도달 — 상승 아르페지오 */
  win(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone('square', f, 0.14, 0.16, i * 0.11));
  }

  // ── 합성 프리미티브 ──

  private tone(type: OscillatorType, freq: number, dur: number, vol: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  private sweep(type: OscillatorType, from: number, to: number, dur: number, vol: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  /** 낮은 사인 펀치(킥드럼 느낌) */
  private thump(freq: number, dur: number, vol: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 2.2, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  /** 화이트노이즈 버스트(로우패스) */
  private noiseBurst(dur: number, cutoff: number, vol: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  // ── BGM: lookahead 스케줄러로 아르페지오 루프 ──

  private startBgm(): void {
    if (!this.ctx || !this.master || this.bgmTimer !== null) return;
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = BGM_VOL;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    this.bgmGain.connect(filter).connect(this.master);

    this.bgmNextTime = this.ctx.currentTime + 0.1;
    this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 150);
  }

  private scheduleBgm(): void {
    if (!this.ctx || !this.bgmGain) return;
    // 0.4초 앞까지 미리 예약
    while (this.bgmNextTime < this.ctx.currentTime + 0.4) {
      const t = this.bgmNextTime;
      const note = BGM_NOTES[this.bgmStep % BGM_NOTES.length];
      this.bgmNote(note, t, BGM_STEP * 0.9, 1);
      if (this.bgmStep % 2 === 0) {
        const bass = BGM_BASS[Math.floor(this.bgmStep / 2) % BGM_BASS.length];
        this.bgmNote(bass, t, BGM_STEP * 1.8, 0.8);
      }
      this.bgmStep++;
      this.bgmNextTime += BGM_STEP;
    }
  }

  private bgmNote(freq: number, t: number, dur: number, vol: number): void {
    if (!this.ctx || !this.bgmGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.bgmGain);
    osc.start(t);
    osc.stop(t + dur);
  }
}

/** 전역 싱글턴 — 씬이 바뀌어도 BGM/설정 유지 */
export const sfx = new Sfx();
