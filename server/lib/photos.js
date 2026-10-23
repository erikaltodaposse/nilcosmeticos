// Fotos das tarefas. Duas formas de guardar, com a mesma interface:
// - disco (DATA_DIR/uploads/AAAA-MM/<uuid>.jpg), no desenvolvimento e em servidor com disco;
// - Vercel Blob, na Vercel, onde o disco do servidor é descartável.
// O banco guarda a referência (caminho relativo ou URL do Blob). A foto só chega ao navegador pela rota autenticada.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { put, del } from '@vercel/blob';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png' };
const CONTENT_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png' };

/** Tipo real pelo conteúdo (assinatura do arquivo), sem confiar no que o cliente declarou. */
export function sniffImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8 && png.every((b, i) => buffer[i] === b)) return 'image/png';
  return null;
}

function photoName(dateKey, type) {
  return `${dateKey.slice(0, 7)}/${crypto.randomUUID()}${ALLOWED_TYPES[type]}`;
}

export function diskPhotoStore(uploadsDir) {
  const RELATIVE_RE = /^\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|png)$/;
  const resolve = (ref) => (ref && RELATIVE_RE.test(ref) ? path.join(uploadsDir, ...ref.split('/')) : null);
  return {
    kind: 'disk',
    dir: uploadsDir,
    async save(dateKey, buffer, type) {
      const ref = photoName(dateKey, type);
      const file = resolve(ref);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buffer);
      return ref;
    },
    async remove(ref) {
      const file = resolve(ref);
      if (file) fs.rmSync(file, { force: true });
    },
    /** Envia a foto na resposta; devolve false se não existir. */
    async send(res, ref) {
      const file = resolve(ref);
      if (!file || !fs.existsSync(file)) return false;
      res.type(CONTENT_TYPES[path.extname(file)]);
      await new Promise((ok, fail) => fs.createReadStream(file).on('error', fail).on('end', ok).pipe(res));
      return true;
    },
  };
}

export function blobPhotoStore(token) {
  const isBlobUrl = (ref) => {
    try {
      const url = new URL(ref);
      return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com');
    } catch {
      return false;
    }
  };
  return {
    kind: 'blob',
    async save(dateKey, buffer, type) {
      // O nome tem um UUID aleatório: a URL não é adivinhável e nunca é mostrada ao navegador.
      const blob = await put(`fotos/${photoName(dateKey, type)}`, buffer, {
        access: 'public',
        contentType: type,
        addRandomSuffix: false,
        token,
      });
      return blob.url;
    },
    async remove(ref) {
      if (isBlobUrl(ref)) await del(ref, { token }).catch(() => {});
    },
    async send(res, ref) {
      if (!isBlobUrl(ref)) return false;
      const upstream = await fetch(ref);
      if (!upstream.ok || !upstream.body) return false;
      res.type(upstream.headers.get('content-type') || 'image/jpeg');
      await new Promise((ok, fail) => Readable.fromWeb(upstream.body).on('error', fail).on('end', ok).pipe(res));
      return true;
    },
  };
}
