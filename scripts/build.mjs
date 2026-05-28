import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

async function removeMacMetadata(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.name === '.DS_Store') {
      await rm(path, { force: true });
    } else if (entry.isDirectory()) {
      await removeMacMetadata(path);
    }
  }));
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('manifest.json', 'dist/manifest.json');
await cp('src', 'dist/src', { recursive: true });
await cp('icons', 'dist/icons', { recursive: true });
await cp('_locales', 'dist/_locales', { recursive: true });
await removeMacMetadata('dist');
console.log('Built dist/ extension scaffold.');
