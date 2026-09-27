import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/* global URL, fetch, Buffer, console */

const root = new URL('../public/', import.meta.url);
await mkdir(new URL('hdri/', root), { recursive: true });
await mkdir(new URL('textures/', root), { recursive: true });
await mkdir(new URL('models/', root), { recursive: true });

const assets = [
  {
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/limpopo_golf_course_2k.hdr',
    output: new URL('hdri/limpopo_golf_course_2k.hdr', root),
  },
];
for (const asset of assets) {
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`Could not download ${asset.url}: ${response.status}`);
  await writeFile(asset.output, Buffer.from(await response.arrayBuffer()));
  console.log(`Downloaded ${join('public', asset.output.pathname.split('/public/')[1])}`);
}
