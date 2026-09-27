export type ChargeStage = 'idle' | 'power' | 'accuracy';

const POWER_CYCLE_MS = 1400;
const ACCURACY_SWEEP_MS = 900;

/**
 * Hold-to-charge power meter followed by a timing-based accuracy sweep.
 * Bound to a dedicated trigger element and the Space key so canvas drags stay free for aiming.
 */
export class PowerCharge {
  stage: ChargeStage = 'idle';
  enabled = true;
  private started = 0;
  private marker = 0;

  constructor(
    trigger: HTMLElement,
    private readonly onPower: (value: number) => void,
    private readonly onAccuracy: (value: number) => void,
    private readonly onComplete: () => void,
  ) {
    trigger.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      trigger.setPointerCapture(event.pointerId);
      this.press();
    });
    trigger.addEventListener('pointerup', () => this.release());
    trigger.addEventListener('pointercancel', () => this.release());
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space' && !event.repeat && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        this.press();
      }
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'Space') this.release();
    });
  }

  reset(): void {
    this.stage = 'idle';
    this.onPower(0);
    this.onAccuracy(0);
  }

  private press(): void {
    if (!this.enabled) return;
    if (this.stage === 'idle') {
      this.stage = 'power';
      this.started = performance.now();
    } else if (this.stage === 'accuracy') {
      this.onAccuracy(this.accuracyAt(performance.now()));
      this.stage = 'idle';
      this.onComplete();
    }
  }

  private release(): void {
    if (this.stage !== 'power') return;
    this.onPower(this.powerAt(performance.now()));
    this.stage = 'accuracy';
    this.started = performance.now();
  }

  private powerAt(now: number): number {
    const t = ((now - this.started) % POWER_CYCLE_MS) / POWER_CYCLE_MS;
    return t <= 0.5 ? t * 2 : 2 - t * 2;
  }

  private accuracyAt(now: number): number {
    const t = ((now - this.started) % ACCURACY_SWEEP_MS) / ACCURACY_SWEEP_MS;
    this.marker = t <= 0.5 ? t * 2 : 2 - t * 2;
    return (this.marker - 0.5) * 2;
  }

  update(now = performance.now()): void {
    if (this.stage === 'power') this.onPower(this.powerAt(now));
    else if (this.stage === 'accuracy') this.onAccuracy(this.accuracyAt(now));
  }
}
