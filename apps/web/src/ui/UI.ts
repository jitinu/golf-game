import type { GameSession } from '../game/GameSession.js';
import { CourseSelect } from './CourseSelect.js';
import { Hud } from './Hud.js';
import { WindWidget } from './WindWidget.js';
import { ClubSelector } from './ClubSelector.js';
import { Meters } from './Meters.js';
import { Scorecard } from './Scorecard.js';
import { NameEntry } from './NameEntry.js';
import { Leaderboard } from './Leaderboard.js';
import { Settings } from './Settings.js';
import { StatsOverlay } from './StatsOverlay.js';
import { Toast } from './Toast.js';
import './styles.css';

export class UI {
  readonly root = document.createElement('div');
  readonly hud: Hud;
  readonly wind: WindWidget;
  readonly meters: Meters;
  readonly clubs: ClubSelector;
  readonly toast: Toast;
  readonly scorecard: Scorecard;
  readonly nameEntry: NameEntry;
  readonly leaderboard: Leaderboard;
  readonly settings: Settings;
  readonly stats: StatsOverlay;
  private readonly gameplay: HTMLElement[];
  private courseSelect: CourseSelect | undefined;
  private lastMessage: string | undefined;

  constructor(
    private readonly session: GameSession,
    private readonly onStartCourse: (path: string) => void,
  ) {
    this.root.className = 'ui';
    document.body.append(this.root);
    this.hud = new Hud(this.root);
    this.wind = new WindWidget(this.root);
    this.meters = new Meters(this.root);
    this.clubs = new ClubSelector(this.root, (id) => session.setClub(id));
    this.toast = new Toast(this.root);
    this.stats = new StatsOverlay(this.root);
    this.scorecard = new Scorecard(this.root, () => {
      this.scorecard.hide();
      this.session.requestNameEntry();
    });
    this.nameEntry = new NameEntry(this.root, (name) => {
      void this.submitName(name);
    });
    this.leaderboard = new Leaderboard(this.root, () => {
      this.leaderboard.hide();
      this.session.reset();
      this.showCourseSelect();
    });
    this.settings = new Settings(this.root, () => {
      location.reload();
    });
    const settingsButton = document.createElement('button');
    settingsButton.className = 'button settings-button';
    settingsButton.textContent = 'Settings';
    settingsButton.onclick = () => this.settings.show();
    this.root.append(settingsButton);
    this.gameplay = [this.hud.root, this.hud.swingButton, this.wind.root, this.meters.root, this.clubs.root];
    this.showCourseSelect();
    session.onChange((state) => {
      const inRound = state.phase !== 'courseSelect';
      this.gameplay.forEach((element) => {
        element.style.display = inRound ? '' : 'none';
      });
      this.hud.update(state, session.course?.manifest.name ?? 'Course');
      this.wind.update(state);
      this.meters.update(state.power, state.accuracy);
      this.clubs.select(state.selectedClub);
      this.clubs.setEnabled(state.phase === 'aiming');
      if (state.message && state.message !== this.lastMessage) this.toast.show(state.message, 2200);
      this.lastMessage = state.message;
      if (state.phase === 'scorecard') this.scorecard.show(session.strokes, session.course?.manifest.holes.map((hole) => hole.par) ?? []);
      if (state.phase === 'nameEntry') this.nameEntry.show();
    });
  }

  showCourseSelect(): void {
    this.courseSelect?.remove();
    this.courseSelect = new CourseSelect(this.root, this.session.scoreService, (course) => {
      this.courseSelect?.remove();
      this.onStartCourse(course.path);
    });
  }

  hideCourseSelect(): void {
    this.courseSelect?.remove();
  }

  private async submitName(name: string): Promise<void> {
    this.nameEntry.setBusy(true);
    try {
      const response = await this.session.finish(name);
      this.nameEntry.hide();
      if (this.session.course) {
        this.leaderboard.show(await this.session.scoreService.leaderboard(this.session.course.manifest.courseId), response?.scoreId);
      }
    } catch (error) {
      this.nameEntry.setError(`Could not save score: ${String(error)}`);
    } finally {
      this.nameEntry.setBusy(false);
    }
  }
}
