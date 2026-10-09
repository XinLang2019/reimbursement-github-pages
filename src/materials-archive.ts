import { zip } from 'fflate';

type ArchiveEntry = { name: string; file: Blob };
export async function createMaterialsArchive(entries: ArchiveEntry[], progress: (done: number, total: number) => void = () => {}) {
  if (!entries.length) throw new Error('没有可备份的材料');
  const files: Record<string, Uint8Array> = Object.create(null);
  const digits = Math.max(3, String(entries.length).length);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    // Global sequence numbers preserve merge order and prevent duplicate names overwriting files.
    const safeName = entry.name.replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '') || '材料';
    const name = `${String(index + 1).padStart(digits, '0')}_${safeName}`;
    files[name] = new Uint8Array(await entry.file.arrayBuffer());
    progress(index + 1, entries.length);
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data));
  });
  return new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
}
