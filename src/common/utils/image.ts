export type ImageKind = 'jpeg' | 'png' | 'webp';

/**
 * Identifica o formato pelo conteúdo real (magic bytes), ignorando extensão e
 * Content-Type, que o cliente controla. SVG e qualquer outro formato → null.
 */
export function detectImageKind(buffer: Buffer): ImageKind | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => buffer[i] === byte)) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
