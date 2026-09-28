import type { ClubDef } from '@golf/sim';

type AudioContextConstructor = new () => AudioContext;

function contextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return candidate as AudioContextConstructor | undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class ImpactSound {
  private context: AudioContext | undefined;

  unlock(): void {
    if (!this.context) {
      const Constructor = contextConstructor();
      if (!Constructor) return;
      try {
        this.context = new Constructor();
      } catch {
        this.context = undefined;
        return;
      }
    }
    if (!this.context) return;
    void this.context.resume().catch(() => undefined);
  }

  swoosh(delaySeconds: number): void {
    const context = this.context;
    if (!context) return;
    try {
      const start = context.currentTime + Math.max(0, delaySeconds);
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(0.24);
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.8;
      filter.frequency.setValueAtTime(400, start);
      filter.frequency.exponentialRampToValueAtTime(1800, start + 0.22);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.17);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      source.connect(filter).connect(gain).connect(context.destination);
      source.start(start);
      source.stop(start + 0.25);
    } catch {
      // Audio is presentation-only and must never interrupt gameplay.
    }
  }

  impact(category: ClubDef['category'], launchSpeed: number): void {
    const context = this.context;
    if (!context) return;
    try {
      const now = context.currentTime;
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(0.06);
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.value = category === 'driver' || category === 'wood' ? 2600
        : category === 'hybrid' || category === 'iron' ? 1900
          : category === 'wedge' ? 1500 : 900;
      const gain = context.createGain();
      const level = 0.25 + 0.5 * clamp(launchSpeed / 75, 0, 1);
      gain.gain.setValueAtTime(level, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      source.connect(filter).connect(gain).connect(context.destination);
      source.start(now);
      source.stop(now + 0.07);

      const oscillator = context.createOscillator();
      const thumpGain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 140;
      thumpGain.gain.setValueAtTime(level * 0.45, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      oscillator.connect(thumpGain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.09);
    } catch {
      // Audio is presentation-only and must never interrupt gameplay.
    }
  }

  private noiseBuffer(duration: number): AudioBuffer {
    const context = this.context;
    if (!context) throw new Error('audio context missing');
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) channel[index] = Math.random() * 2 - 1;
    return buffer;
  }
}
