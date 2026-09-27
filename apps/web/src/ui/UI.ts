import { validatePlayerName } from '@golf/protocol';
import type { GameState } from '../game/GameState.js';

export class UI {
  readonly root: HTMLDivElement;
  readonly hud: HTMLDivElement;
  readonly power: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'ui';
    this.root.innerHTML = `<div class="panel course-select"><h1>Pinecrest</h1><p>Three holes. One clean round.</p><button data-start>Start round</button></div>`;
    this.hud = document.createElement('div');
    this.hud.className = 'panel hud';
    this.power = document.createElement('div');
    this.power.className = 'meter power';
    this.title = document.createElement('h2');
    this.hud.append(this.title, this.power);
    this.root.append(this.hud);
    document.body.append(this.root);
    this.injectStyles();
  }
  onStart(callback: () => void): void { this.root.querySelector('[data-start]')?.addEventListener('click', callback); }
  update(state: GameState, distance: number, club: string): void {
    this.title.textContent = `Hole ${state.hole} · Stroke ${state.stroke} · ${club}`;
    this.power.textContent = `${Math.round(state.power * 100)}% power · ${Math.round(distance)} m to pin`;
  }
  nameEntry(): string | null {
    const name = window.prompt('Enter your name') ?? '';
    const result = validatePlayerName(name);
    if (!result.ok) { window.alert(result.reason); return null; }
    return result.name;
  }
  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `:root{font-family:Inter,system-ui,sans-serif;color:#f7fafb}body{margin:0;overflow:hidden;background:#9bb5c4}.ui{position:fixed;inset:0;pointer-events:none}.panel{pointer-events:auto;background:#101d24dd;border:1px solid #ffffff24;border-radius:14px;box-shadow:0 12px 40px #0005;padding:20px}.course-select{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}.course-select button{background:#72c68b;border:0;border-radius:8px;padding:12px 22px;font-weight:700;cursor:pointer}.hud{position:absolute;left:20px;top:20px;min-width:230px}.hud h2{margin:0 0 8px;font-size:16px}.meter{color:#b9d9c3}`;
    document.head.append(style);
  }
}
