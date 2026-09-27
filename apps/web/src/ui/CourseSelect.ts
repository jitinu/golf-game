import type { ScoreService } from '../net/ApiClient.js';
export interface CourseIndexEntry { courseId: string; name: string; description?: string; path: string; holes?: number; par?: number; }
export class CourseSelect {
  readonly root: HTMLDivElement;
  constructor(parent: HTMLElement, scoreService: ScoreService, onStart: (course: CourseIndexEntry) => void) {
    this.root = document.createElement('div'); this.root.className = 'panel course-select'; this.root.innerHTML = '<h1>Pinecrest Golf</h1><p>Choose a course</p><div class="course-list">Loading courses…</div>'; parent.append(this.root);
    void fetch('/courses/index.json').then((response) => response.json() as Promise<CourseIndexEntry[]>).then(async (courses) => {
      const list = this.root.querySelector('.course-list'); if (!list) return; list.innerHTML = '';
      for (const course of courses) { const stats = await scoreService.stats(course.courseId); const button = document.createElement('button'); button.className = 'course-card'; button.innerHTML = `<strong>${course.name}</strong><br><small>${course.description ?? ''} · ${course.holes ?? 3} holes · Par ${course.par ?? 12} · ${stats.plays} plays</small>`; button.onclick = () => onStart(course); list.append(button); }
    }).catch(() => undefined);
  }
  remove(): void { this.root.remove(); }
}
