import { getCosmeticById } from '../shared/catalog';

class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private getContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'square',
    volume = 0.08,
    endFreq?: number
  ) {
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, endFreq),
        ctx.currentTime + durationSec
      );
    }

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  }

  /**
   * 2.2. KNOCK: Som suave de campainha quando visitante espia na borda da janela
   */
  public playDoorbell() {
    this.playTone(659.25, 0.22, 'sine', 0.12); // E5
    setTimeout(() => {
      this.playTone(523.25, 0.38, 'sine', 0.12); // C5
    }, 200);
  }

  /**
   * 3.2. Balões de Fala (Chat Skins): som de digitação (blip) customizado por skin
   */
  public playChatBlip(skinId: string, textLength = 6) {
    const item = getCosmeticById(skinId);
    const baseFreq = item?.meta?.blipFreq ?? 520;
    const wave = item?.meta?.blipWave ?? 'square';
    const count = Math.min(5, Math.max(2, Math.ceil(textLength / 12)));

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const jitter = (Math.random() - 0.5) * 90;
        this.playTone(baseFreq + jitter, 0.055, wave, 0.05);
      }, i * 65);
    }
  }

  public playJump() {
    this.playTone(260, 0.16, 'square', 0.06, 580);
  }

  public playPoke() {
    this.playTone(480, 0.08, 'triangle', 0.09, 760);
    setTimeout(() => this.playTone(760, 0.1, 'triangle', 0.08, 420), 70);
  }

  public playThrow() {
    this.playTone(600, 0.18, 'sine', 0.06, 220);
  }

  public playHit(itemId?: string) {
    if (itemId === 'throw_glitter_bomb') {
      [523, 659, 783, 1046].forEach((f, idx) =>
        setTimeout(() => this.playTone(f, 0.12, 'triangle', 0.06), idx * 45)
      );
    } else {
      this.playTone(190, 0.12, 'square', 0.08, 90);
    }
  }

  public playSpawn(fxId: string) {
    if (fxId === 'fx_cyber_lightning') {
      this.playTone(880, 0.25, 'sawtooth', 0.08, 110);
    } else if (fxId === 'fx_alien_abduction') {
      this.playTone(440, 0.35, 'sine', 0.08, 880);
    } else {
      this.playTone(340, 0.15, 'triangle', 0.07, 680);
    }
  }

  public playClaimGift(itemId: string) {
    if (itemId === 'drop_rubber_duck') {
      // Quack!
      this.playTone(380, 0.12, 'sawtooth', 0.09, 260);
      setTimeout(() => this.playTone(390, 0.14, 'sawtooth', 0.09, 240), 130);
      return;
    }
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.14, 'square', 0.07), i * 65);
    });
  }

  public playGachapon() {
    const notes = [392, 440, 493.88, 523.25, 587.33, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      setTimeout(() => this.playTone(n, 0.12, 'square', 0.07), i * 65);
    });
  }
}

export const soundEngine = new SoundEngine();
