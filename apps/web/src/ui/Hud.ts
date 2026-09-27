import { CLUBS } from '@golf/sim';
import type { GameState } from '../game/GameState.js';

const PHASE_HINTS: Record<GameState['phase'], string> = {
  courseSelect: 'Choose a course',
  aiming: 'Drag on the course or use ← → to aim. Hold SWING (or Space) to charge, release to set power, press again to stop the accuracy marker.',
  charging: 'Release to set power…',
  resolving: 'Ball in flight…',
  holeComplete: 'Hole complete!',
  scorecard: 'Round complete',
  nameEntry: 'Enter your name',
  leaderboard: 'Leaderboard',
};

export class Hud {
  readonly root: HTMLDivElement;
  readonly swingButton: HTMLButtonElement;
  private readonly info: HTMLDivElement;
  private readonly hint: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panel hud';
    this.info = document.createElement('div');
    this.hint = document.createElement('div');
    this.hint.className = 'hud-hint';
    this.swingButton = document.createElement('button');
    this.swingButton.className = 'button primary swing-button';
    this.swingButton.textContent = 'SWING';
    this.root.append(this.info, this.hint);
    parent.append(this.root, this.swingButton);
  }

  update(state: GameState, courseName: string): void {
    const club = CLUBS[state.selectedClub];
    this.info.innerHTML = `<strong>${courseName} · Hole ${state.hole}</strong><div class="hud-grid"><span>Par ${state.par}</span><span>Stroke ${state.stroke}</span><span>${Math.round(state.distanceToPin)} m to pin</span><span>${club?.displayName ?? state.selectedClub}</span></div>`;
    this.hint.textContent = PHASE_HINTS[state.phase];
  }

  setSwingEnabled(enabled: boolean): void {
    this.swingButton.disabled = !enabled;
    this.swingButton.classList.toggle('disabled', !enabled);
  }
}
