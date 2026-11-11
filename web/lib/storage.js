import { get, put } from '@vercel/blob';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { emptyData } from './core.js';

const BLOB_PATH = 'lingueez-personal/vocabulary.json';
const LOCAL_PATH = resolve(process.cwd(), 'data/vocabulary.json');

function localMode() {
  if (process.env.VERCEL) {
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN) throw new Error('Private Blob storage is not configured');
    return false;
  }
  return !process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN;
}

export async function loadData() {
  if (localMode()) {
    try { return { data: JSON.parse(await readFile(LOCAL_PATH, 'utf8')), etag: null }; }
    catch (error) { if (error.code === 'ENOENT') return { data: emptyData(), etag: null }; throw error; }
  }
  const result = await get(BLOB_PATH, { access: 'private' });
  if (!result) return { data: emptyData(), etag: null };
  const data = JSON.parse(await new Response(result.stream).text());
  return { data, etag: result.blob.etag };
}

export async function mutateData(change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = await loadData();
    const result = await change(data);
    if (localMode()) {
      await mkdir(dirname(LOCAL_PATH), { recursive: true });
      await writeFile(LOCAL_PATH, JSON.stringify(data, null, 2));
      return { data, result };
    }
    try {
      await put(BLOB_PATH, JSON.stringify(data), {
        access: 'private', contentType: 'application/json',
        ...(etag ? { allowOverwrite: true, ifMatch: etag } : {})
      });
      return { data, result };
    } catch (error) {
      if (!['BlobPreconditionFailedError', 'BlobAlreadyExistsError'].includes(error.name) || attempt === 4) throw error;
    }
  }
  throw new Error('Unable to save changes');
}
