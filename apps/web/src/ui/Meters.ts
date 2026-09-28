export class Meters {
  readonly root: HTMLDivElement;
  private readonly powerFill: HTMLDivElement;
  private readonly accuracyMarker: HTMLDivElement;
  private readonly powerLabel: HTMLSpanElement;
  private readonly accuracyLabel: HTMLSpanElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panel meters';
    this.root.innerHTML =
      '<div class="meter-label"><span>POWER</span><strong class="power-label"></strong></div><div class="meter-track"><div class="meter-fill power-fill"></div></div>' +
      '<div class="meter-label"><span>ACCURACY</span><strong class="accuracy-label"></strong></div><div class="meter-track accuracy-track"><div class="accuracy-marker"></div></div>';
    this.powerFill = this.root.querySelector('.power-fill') as HTMLDivElement;
    this.accuracyMarker = this.root.querySelector('.accuracy-marker') as HTMLDivElement;
    this.powerLabel = this.root.querySelector('.power-label') as HTMLSpanElement;
    this.accuracyLabel = this.root.querySelector('.accuracy-label') as HTMLSpanElement;
    parent.append(this.root);
  }

  update(power: number, accuracy: number): void {
    const clampedPower = Math.max(0, Math.min(1, power));
    const clampedAccuracy = Math.max(-1, Math.min(1, accuracy));
    this.powerFill.style.width = `${clampedPower * 100}%`;
    this.accuracyMarker.style.left = `${(clampedAccuracy + 1) * 50}%`;
    this.powerLabel.textContent = `${Math.round(clampedPower * 100)}%`;
    this.accuracyLabel.textContent = Math.abs(clampedAccuracy) < 0.05 ? 'pure' : clampedAccuracy > 0 ? `fade ${Math.round(clampedAccuracy * 100)}` : `draw ${Math.round(-clampedAccuracy * 100)}`;
  }
}
