export class PowerCharge {
  private active = false;
  private accuracyPhase = false;
  private started = 0;
  private marker = 0;
  private onPowerValue: (value: number) => void = () => undefined;
  private onAccuracyValue: (value: number) => void = () => undefined;
  constructor(private readonly element: HTMLElement, onPower: (value: number) => void, onAccuracy: (value: number) => void) {
    this.onPowerValue = onPower;
    this.onAccuracyValue = onAccuracy;
    element.addEventListener('pointerdown', () => this.start());
    window.addEventListener('keydown', (event) => { if (event.code === 'Space') { event.preventDefault(); this.start(); } });
    window.addEventListener('pointerup', () => this.release());
    window.addEventListener('keyup', (event) => { if (event.code === 'Space') this.release(); });
  }
  private start(): void { if (!this.active) { this.active = true; this.accuracyPhase = false; this.started = performance.now(); } else if (this.accuracyPhase) { this.onAccuracyValue((this.marker - 0.5) * 2); this.active = false; } }
  private release(): void { if (!this.active || this.accuracyPhase) return; this.onPowerValue(Math.min(1, (performance.now() - this.started) / 1200)); this.accuracyPhase = true; this.started = performance.now(); }
  update(now = performance.now()): void {
    if (!this.active) return;
    if (!this.accuracyPhase) { const t = Math.min(1, (now - this.started) / 1200); this.onPowerValue(t <= 0.5 ? t * 2 : 2 - t * 2); }
    else { this.marker = Math.min(1, (now - this.started) / 800); this.onAccuracyValue((this.marker - 0.5) * 2); }
  }
}
