import { getCosmeticById } from '../shared/catalog';

export type AmbientSoundId = 'rain' | 'fireplace' | 'coffee' | 'keyboard' | 'brown_noise';

interface ActiveAmbientTrack {
  stop: () => void;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  // Controle de Som Ambiente de Foco (independente dos efeitos sonoros!)
  public ambientVolume = 0.5;
  private ambientMasterGain: GainNode | null = null;
  private activeAmbients = new Map<AmbientSoundId, ActiveAmbientTrack>();

  private ensureRawContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getContext(): AudioContext | null {
    if (this.muted) return null;
    return this.ensureRawContext();
  }

  private getAmbientMasterGain(): { ctx: AudioContext; master: GainNode } | null {
    const ctx = this.ensureRawContext();
    if (!ctx) return null;
    if (!this.ambientMasterGain) {
      this.ambientMasterGain = ctx.createGain();
      this.ambientMasterGain.gain.setValueAtTime(this.ambientVolume, ctx.currentTime);
      this.ambientMasterGain.connect(ctx.destination);
    }
    return { ctx, master: this.ambientMasterGain };
  }

  public setAmbientVolume(vol: number) {
    this.ambientVolume = Math.max(0, Math.min(1, vol));
    if (this.ambientMasterGain && this.ctx) {
      this.ambientMasterGain.gain.setTargetAtTime(this.ambientVolume, this.ctx.currentTime, 0.04);
    }
  }

  public isAmbientActive(id: AmbientSoundId): boolean {
    return this.activeAmbients.has(id);
  }

  public getActiveAmbientIds(): AmbientSoundId[] {
    return Array.from(this.activeAmbients.keys());
  }

  public stopAllAmbientSounds() {
    for (const track of this.activeAmbients.values()) {
      track.stop();
    }
    this.activeAmbients.clear();
  }

  public toggleAmbientSound(id: AmbientSoundId): boolean {
    const existing = this.activeAmbients.get(id);
    if (existing) {
      existing.stop();
      this.activeAmbients.delete(id);
      return false;
    }

    const track = this.startAmbientTrack(id);
    if (track) {
      this.activeAmbients.set(id, track);
      return true;
    }
    return false;
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number, mode: 'white' | 'pink' | 'brown'): AudioBuffer {
    const bufferSize = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);

    if (mode === 'white') {
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
    } else if (mode === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
        b6 = white * 0.115926;
      }
    } else {
      // Brown noise (1/f^2)
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
        output[i] *= 3.2;
      }
    }
    return buffer;
  }

  private startAmbientTrack(id: AmbientSoundId): ActiveAmbientTrack | null {
    const env = this.getAmbientMasterGain();
    if (!env) return null;
    const { ctx, master } = env;

    if (id === 'rain') {
      // Chuva suave na janela: ruído rosa filtrado + gotinhas ocasionais no vidro
      const noiseBuf = this.createNoiseBuffer(ctx, 4, 'pink');
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1050;

      const gain = ctx.createGain();
      gain.gain.value = 0.28;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();

      const dropInterval = window.setInterval(() => {
        if (Math.random() > 0.55) return;
        const osc = ctx.createOscillator();
        const dropGain = ctx.createGain();
        osc.type = 'sine';
        const baseF = 1100 + Math.random() * 900;
        osc.frequency.setValueAtTime(baseF, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(baseF * 1.35, ctx.currentTime + 0.045);

        dropGain.gain.setValueAtTime(0.018, ctx.currentTime);
        dropGain.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + 0.05);

        osc.connect(dropGain);
        dropGain.connect(master);
        osc.start();
        osc.stop(ctx.currentTime + 0.055);
      }, 220);

      return {
        stop: () => {
          clearInterval(dropInterval);
          try {
            src.stop();
            src.disconnect();
            gain.disconnect();
          } catch {}
        },
      };
    }

    if (id === 'brown_noise') {
      // Ruído Marrom profundo (Foco / Concentração)
      const noiseBuf = this.createNoiseBuffer(ctx, 5, 'brown');
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 340;

      const gain = ctx.createGain();
      gain.gain.value = 0.36;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();

      return {
        stop: () => {
          try {
            src.stop();
            src.disconnect();
            gain.disconnect();
          } catch {}
        },
      };
    }

    if (id === 'fireplace') {
      // Lareira aconchegante: brasa grave + estalos de madeira
      const noiseBuf = this.createNoiseBuffer(ctx, 4, 'brown');
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      const lowFilter = ctx.createBiquadFilter();
      lowFilter.type = 'lowpass';
      lowFilter.frequency.value = 170;

      const gain = ctx.createGain();
      gain.gain.value = 0.24;

      src.connect(lowFilter);
      lowFilter.connect(gain);
      gain.connect(master);
      src.start();

      const crackleBuf = this.createNoiseBuffer(ctx, 0.04, 'white');
      const crackleInterval = window.setInterval(() => {
        if (Math.random() > 0.65) return;
        const bursts = Math.random() > 0.7 ? 2 : 1;
        for (let b = 0; b < bursts; b++) {
          setTimeout(() => {
            const popSrc = ctx.createBufferSource();
            popSrc.buffer = crackleBuf;

            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 1800 + Math.random() * 2400;
            bp.Q.value = 3.5;

            const popGain = ctx.createGain();
            const vol = 0.04 + Math.random() * 0.06;
            popGain.gain.setValueAtTime(vol, ctx.currentTime);
            popGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.032);

            popSrc.connect(bp);
            bp.connect(popGain);
            popGain.connect(master);
            popSrc.start();
          }, b * (25 + Math.random() * 45));
        }
      }, 160);

      return {
        stop: () => {
          clearInterval(crackleInterval);
          try {
            src.stop();
            src.disconnect();
            gain.disconnect();
          } catch {}
        },
      };
    }

    if (id === 'coffee') {
      // Cafeteira passando café: vapor suave + borbulhar quentinho de percolador
      const steamBuf = this.createNoiseBuffer(ctx, 4, 'pink');
      const src = ctx.createBufferSource();
      src.buffer = steamBuf;
      src.loop = true;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 540;
      bp.Q.value = 1.4;

      const gain = ctx.createGain();
      gain.gain.value = 0.14;

      src.connect(bp);
      bp.connect(gain);
      gain.connect(master);
      src.start();

      const bubbleInterval = window.setInterval(() => {
        if (Math.random() > 0.6) return;
        const osc = ctx.createOscillator();
        const bGain = ctx.createGain();
        osc.type = 'sine';
        const f = 190 + Math.random() * 220;
        osc.frequency.setValueAtTime(f, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(f * 1.85, ctx.currentTime + 0.075);

        bGain.gain.setValueAtTime(0.025, ctx.currentTime);
        bGain.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + 0.08);

        osc.connect(bGain);
        bGain.connect(master);
        osc.start();
        osc.stop(ctx.currentTime + 0.085);
      }, 190);

      return {
        stop: () => {
          clearInterval(bubbleInterval);
          try {
            src.stop();
            src.disconnect();
            gain.disconnect();
          } catch {}
        },
      };
    }

    if (id === 'keyboard') {
      // Teclado Mecânico ASMR (switch tátil suave em cadência natural de programação)
      let stopped = false;
      let timerId: number | undefined;
      const clickNoise = this.createNoiseBuffer(ctx, 0.025, 'white');

      const triggerKeyClick = (isSpacebar = false) => {
        if (stopped) return;
        // Corpo "thock" da tecla
        const osc = ctx.createOscillator();
        const thockGain = ctx.createGain();
        osc.type = 'triangle';
        const startF = isSpacebar ? 210 : 280 + (Math.random() - 0.5) * 70;
        osc.frequency.setValueAtTime(startF, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(75, ctx.currentTime + 0.032);

        thockGain.gain.setValueAtTime(isSpacebar ? 0.055 : 0.038, ctx.currentTime);
        thockGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);

        osc.connect(thockGain);
        thockGain.connect(master);
        osc.start();
        osc.stop(ctx.currentTime + 0.038);

        // Clique mecânico agudo sutil
        const nSrc = ctx.createBufferSource();
        nSrc.buffer = clickNoise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = isSpacebar ? 1500 : 2200 + Math.random() * 700;
        bp.Q.value = 2.5;

        const cGain = ctx.createGain();
        cGain.gain.setValueAtTime(0.022, ctx.currentTime);
        cGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.018);

        nSrc.connect(bp);
        bp.connect(cGain);
        cGain.connect(master);
        nSrc.start();
      };

      const scheduleNextKey = () => {
        if (stopped) return;
        const isPause = Math.random() < 0.14;
        const delay = isPause ? 420 + Math.random() * 650 : 85 + Math.random() * 145;
        timerId = window.setTimeout(() => {
          triggerKeyClick(Math.random() < 0.16);
          scheduleNextKey();
        }, delay);
      };

      scheduleNextKey();

      return {
        stop: () => {
          stopped = true;
          if (timerId !== undefined) clearTimeout(timerId);
        },
      };
    }

    return null;
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

  /**
   * Sino suave e harmônico para transição do Pomodoro / Timer de Foco
   */
  public playFocusBell() {
    const chord = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    chord.forEach((freq, idx) => {
      setTimeout(() => {
        this.playTone(freq, 0.55, 'sine', 0.09);
      }, idx * 110);
    });
  }

  /**
   * Toque discreto de gotinha / harpa para lembrete de bem-estar
   */
  public playWellnessChime() {
    this.playTone(587.33, 0.22, 'sine', 0.06, 880);
    setTimeout(() => {
      this.playTone(880, 0.32, 'sine', 0.06);
    }, 140);
  }

  /**
   * 📳 Som Clássico do MSN Messenger ("Tu-du-dum!" de mensagem chegando + vibração de Chamar Atenção)
   */
  public playMsnAttention() {
    const ctx = this.getContext();
    if (!ctx) return;

    const playMsnChimeNote = (
      freq: number,
      delayMs: number,
      durationSec: number,
      vol: number
    ) => {
      setTimeout(() => {
        const c = this.getContext();
        if (!c) return;
        const now = c.currentTime;

        // Fundamental (timbre cristalino estilo marimba/sino do MSN Messenger)
        const osc1 = c.createOscillator();
        const osc2 = c.createOscillator();
        const gain = c.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, now);

        // Harmônico de oitava suave que dá o brilho clássico do alerta do MSN
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(freq * 2, now);

        const g2 = c.createGain();
        g2.gain.setValueAtTime(0.28, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(vol, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + durationSec);

        osc1.connect(gain);
        osc2.connect(g2);
        g2.connect(gain);
        gain.connect(c.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + durationSec + 0.02);
        osc2.stop(now + durationSec + 0.02);
      }, delayMs);
    };

    // 1. Tríade clássica de mensagem chegando do MSN ("Tu - du - dum!")
    playMsnChimeNote(783.99, 0, 0.16, 0.16); // G5 ("Tu")
    playMsnChimeNote(987.77, 95, 0.16, 0.17); // B5 ("du")
    playMsnChimeNote(1174.66, 195, 0.58, 0.2); // D6 ("dum!" longo e brilhante)
    playMsnChimeNote(587.33, 195, 0.55, 0.11); // D5 (base encorpada do acorde final)

    // 2. Tremor / Zumbido clássico do "Chamar Atenção" acompanhando a tremedeira da janela
    const buzzPulses = [0, 75, 150, 225, 300, 380, 460];
    buzzPulses.forEach((delay, idx) => {
      setTimeout(() => {
        const f = idx % 2 === 0 ? 145 : 185;
        this.playTone(f, 0.055, 'sawtooth', 0.045, f * 0.85);
      }, delay);
    });
  }

  /**
   * 📨 Som de envio de convite de amizade (arpejo leve e positivo de carta enviada)
   */
  public playFriendInviteSent() {
    this.playTone(523.25, 0.12, 'triangle', 0.1, 659.25); // C5 -> E5
    setTimeout(() => {
      this.playTone(659.25, 0.14, 'triangle', 0.11); // E5
    }, 90);
    setTimeout(() => {
      this.playTone(987.77, 0.28, 'sine', 0.12); // B5
    }, 185);
  }

  /**
   * 🤝 Som de alerta quando chega um convite de amizade ou quando uma amizade é aceita
   */
  public playFriendRequestAlert() {
    const notes = [587.33, 739.99, 880, 1174.66]; // D5, F#5, A5, D6
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        this.playTone(freq, idx === notes.length - 1 ? 0.36 : 0.14, 'sine', 0.12);
      }, idx * 85);
    });
  }

  /**
   * 🟢 Som Nostálgico de Login do MSN Messenger (quando um amigo entra online no cantinho)
   */
  public playFriendOnlineMsn() {
    const ctx = this.getContext();
    if (!ctx) return;

    const playLoginChimeNote = (
      freq: number,
      delayMs: number,
      durationSec: number,
      vol: number
    ) => {
      setTimeout(() => {
        const c = this.getContext();
        if (!c) return;
        const now = c.currentTime;

        const oscMain = c.createOscillator();
        const oscWarm = c.createOscillator();
        const gain = c.createGain();
        const warmGain = c.createGain();

        oscMain.type = 'sine';
        oscMain.frequency.setValueAtTime(freq, now);

        oscWarm.type = 'triangle';
        oscWarm.frequency.setValueAtTime(freq * 1.5, now);
        warmGain.gain.setValueAtTime(0.18, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(vol, now + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + durationSec);

        oscMain.connect(gain);
        oscWarm.connect(warmGain);
        warmGain.connect(gain);
        gain.connect(c.destination);

        oscMain.start(now);
        oscWarm.start(now);
        oscMain.stop(now + durationSec + 0.02);
        oscWarm.stop(now + durationSec + 0.02);
      }, delayMs);
    };

    // Acorde ascendente cristalino estilo MSN Messenger Sign-In (E5 -> B5 -> E6)
    playLoginChimeNote(659.25, 0, 0.24, 0.12); // E5
    playLoginChimeNote(987.77, 115, 0.26, 0.13); // B5
    playLoginChimeNote(1318.51, 230, 0.55, 0.14); // E6
  }

  /**
   * 👋 Som amigável de "Dar Oi" (aceno rápido)
   */
  public playWaveHello() {
    this.playTone(659.25, 0.12, 'sine', 0.11, 880);
    setTimeout(() => {
      this.playTone(1046.5, 0.24, 'triangle', 0.12);
    }, 95);
  }

  /**
   * 💨 Som suave de fumaça ("poof!") quando um amigo fica offline e some da sala
   */
  public playSmokePoof() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Sopro de fumaça (ruído rosa filtrado com envelope macio)
    const noiseBuf = this.createNoiseBuffer(ctx, 0.28, 'pink');
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(920, now);
    filter.frequency.exponentialRampToValueAtTime(240, now + 0.26);
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.27);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);

    // 2. "Poof" grave suave descendente
    this.playTone(230, 0.2, 'sine', 0.09, 85);
  }
}

export const soundEngine = new SoundEngine();


