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
    this.info.innerHTML = `
      <div class="hud-course">${courseName}</div>
      <div class="hud-hole-row">
        <strong class="hud-hole">HOLE ${state.hole}</strong>
        <span class="hud-par">PAR ${state.par}</span>
      </div>
      <div class="hud-grid">
        <div class="hud-stat"><span>STROKE</span><strong>${state.stroke}</strong></div>
        <div class="hud-stat"><span>TO PIN</span><strong>${Math.round(state.distanceToPin)}<small> m</small></strong></div>
        <div class="hud-stat"><span>CLUB</span><strong>${club?.displayName ?? state.selectedClub}</strong></div>
      </div>`;
    if (state.phase === 'resolving') {
      this.hint.innerHTML = '<span class="hud-flight">BALL IN FLIGHT</span>';
    } else {
      this.hint.textContent = PHASE_HINTS[state.phase];
    }
  }

  setSwingEnabled(enabled: boolean): void {
    this.swingButton.disabled = !enabled;
    this.swingButton.classList.toggle('disabled', !enabled);
  }
}
