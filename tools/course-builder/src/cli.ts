import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildCourseDirectory } from './builder.js';

const root = resolve(new URL('../../../', import.meta.url).pathname);
const coursesRoot = join(root, 'courses');
const outputRoot = join(root, 'apps/web/public/courses');
const entries = await readdir(coursesRoot, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const source = join(coursesRoot, entry.name, 'course.src.json');
  const output = join(outputRoot, entry.name);
  try {
    await buildCourseDirectory(source, output);
    console.log(`Built ${entry.name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
