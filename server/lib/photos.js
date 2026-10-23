// Gravação de fotos fora da pasta pública. O caminho guardado no banco é relativo a uploadsDir.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png' };

/** Tipo real pelo conteúdo (assinatura do arquivo), sem confiar no que o cliente declarou. */
export function sniffImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8 && png.every((b, i) => buffer[i] === b)) return 'image/png';
  return null;
}

/** Grava em uploadsDir/AAAA-MM/<uuid>.<ext> e devolve o caminho relativo com "/". */
export function savePhoto(uploadsDir, dateKey, buffer, type) {
  const folder = dateKey.slice(0, 7);
  const name = `${crypto.randomUUID()}${ALLOWED_TYPES[type]}`;
  fs.mkdirSync(path.join(uploadsDir, folder), { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, folder, name), buffer);
  return `${folder}/${name}`;
}

/** Caminho absoluto de uma foto, recusando qualquer coisa que saia de uploadsDir. */
export function resolvePhoto(uploadsDir, relative) {
  if (!relative || !/^\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|png)$/.test(relative)) return null;
  return path.join(uploadsDir, ...relative.split('/'));
}

export function deletePhoto(uploadsDir, relative) {
  const file = resolvePhoto(uploadsDir, relative);
  if (file) fs.rmSync(file, { force: true });
}
