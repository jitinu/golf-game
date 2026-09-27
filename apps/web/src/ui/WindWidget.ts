import type { GameState } from '../game/GameState.js';

/** Compass-style wind readout: the arrow points where the wind blows relative to the current aim (up = downwind). */
export class WindWidget {
  readonly root: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private readonly speed: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly ticks: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panel wind-widget';
    this.root.setAttribute('aria-label', 'Wind');
    const dial = document.createElement('div');
    dial.className = 'wind-dial';
    this.ticks = document.createElement('div');
    this.ticks.className = 'wind-ticks';
    this.arrow = document.createElement('div');
    this.arrow.className = 'wind-arrow';
    this.arrow.innerHTML = '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><path d="M20 3 L30 20 L22.5 17 L22.5 37 L17.5 37 L17.5 17 L10 20 Z" /></svg>';
    dial.append(this.ticks, this.arrow);
    const text = document.createElement('div');
    text.className = 'wind-text';
    const title = document.createElement('div');
    title.className = 'wind-title';
    title.textContent = 'Wind';
    this.speed = document.createElement('div');
    this.speed.className = 'wind-speed';
    this.label = document.createElement('div');
    this.label.className = 'wind-label';
    text.append(title, this.speed, this.label);
    this.root.append(dial, text);
    parent.append(this.root);
  }

  update(state: GameState): void {
    const { x, z } = state.wind;
    const speed = Math.hypot(x, z);
    const forwardX = Math.sin(state.aimYaw);
    const forwardZ = -Math.cos(state.aimYaw);
    const along = x * forwardX + z * forwardZ;
    const across = x * -forwardZ + z * forwardX;
    const relative = Math.atan2(across, along);
    this.arrow.style.transform = `rotate(${relative}rad)`;
    this.arrow.style.opacity = speed < 0.3 ? '0.35' : '1';
    this.speed.textContent = `${speed.toFixed(1)} m/s`;
    this.label.textContent = describe(along, across, speed);
    this.root.classList.toggle('wind-strong', speed > 4.5);
  }
}

function describe(along: number, across: number, speed: number): string {
  if (speed < 0.3) return 'Calm';
  const parts: string[] = [];
  if (Math.abs(along) > speed * 0.35) parts.push(along > 0 ? 'Helping' : 'Into');
  if (Math.abs(across) > speed * 0.35) parts.push(across > 0 ? 'L → R' : 'R → L');
  return parts.join(' · ') || 'Crosswind';
}
