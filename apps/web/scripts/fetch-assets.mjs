import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/* global URL, fetch, Buffer, console */

const root = new URL('../public/', import.meta.url);
const assets = [
  ['hdri/limpopo_golf_course_2k.hdr', 'limpopo_golf_course', '2k', 'hdr'],
  ['hdri/limpopo_golf_course_4k.hdr', 'limpopo_golf_course', '4k', 'hdr'],
  ['textures/green/color.jpg', 'grass_medium_01', '1k', 'jpg'],
  ['textures/fairway/color.jpg', 'forest_ground_01', '1k', 'jpg'],
  ['textures/rough/color.jpg', 'forest_ground_01', '1k', 'jpg'],
  ['textures/bunker/color.jpg', 'sand_01', '1k', 'jpg'],
  ['textures/path/color.jpg', 'gravel_road', '1k', 'jpg'],
  ['textures/dirt/color.jpg', 'brown_mud_leaves_01', '1k', 'jpg'],
];

async function exists(url) {
  try { await access(url); return true; } catch { return false; }
}

async function polyhaven(id, extension, variant) {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) return undefined;
  const files = await response.json();
  const candidates = Object.values(files).flatMap((value) => Object.values(value ?? {})).filter((value) => typeof value === 'string');
  return candidates.find((value) => value.includes(variant) && value.endsWith(`.${extension}`)) ?? candidates.find((value) => value.endsWith(`.${extension}`));
}

for (const [output, id, variant, extension] of assets) {
  const destination = new URL(output, root);
  if (await exists(destination)) { console.log(`Skipping ${output}`); continue; }
  const url = await polyhaven(id, extension, variant);
  if (!url) { console.log(`Missing Poly Haven asset ${id}`); continue; }
  await mkdir(new URL('.', destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) { console.log(`Missing ${output} (${response.status})`); continue; }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  console.log(`Downloaded ${join('public', output)}`);
}
