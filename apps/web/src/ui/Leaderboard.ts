import type { LeaderboardResponse } from '@golf/protocol';

function formatToPar(value: number): string {
  return value === 0 ? 'E' : value > 0 ? `+${value}` : `${value}`;
}

export class Leaderboard {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, onAgain: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'modal';
    this.root.innerHTML = '<div class="panel"><h2>Leaderboard</h2><p class="plays"></p><div class="entries"></div><button class="button primary">Play again</button></div>';
    this.root.querySelector('button')?.addEventListener('click', onAgain);
    this.root.style.display = 'none';
    parent.append(this.root);
  }

  show(response: LeaderboardResponse, highlightScoreId?: string): void {
    const plays = this.root.querySelector('.plays');
    if (plays) plays.textContent = `${response.plays} ${response.plays === 1 ? 'round' : 'rounds'} played`;
    const entries = this.root.querySelector('.entries');
    if (entries) {
      entries.innerHTML = response.entries.length
        ? `<table><thead><tr><th>#</th><th>Player</th><th>Strokes</th><th>To par</th></tr></thead><tbody>${response.entries
            .slice(0, 25)
            .map(
              (entry) =>
                `<tr${entry.scoreId && entry.scoreId === highlightScoreId ? ' class="mine"' : ''}><td>${entry.rank}</td><td>${escapeHtml(entry.playerName)}</td><td>${entry.totalStrokes}</td><td>${formatToPar(entry.toPar)}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : '<p>No scores yet — you are the first!</p>';
    }
    this.root.style.display = 'grid';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
