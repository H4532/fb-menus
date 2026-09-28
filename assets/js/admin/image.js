// FB Menus admin — shrink photos on the device before upload.
// A 6 MB phone photo becomes ~150 KB (large) + ~30 KB (thumbnail), which keeps
// the guest menu fast on hotel Wi-Fi.

const QUALITY = 0.8;

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file is not an image the browser can read. Use JPG, PNG or WebP.'));
    img.src = URL.createObjectURL(file);
  });
}

function toBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => {
      if (b && b.type === 'image/webp') return resolve(b);
      canvas.toBlob((j) => resolve(j), 'image/jpeg', QUALITY);   // Safari fallback
    }, 'image/webp', QUALITY);
  });
}

/** Fit inside max×max, keeping proportions. */
async function fit(src, max) {
  const w = src.width;
  const h = src.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return toBlob(c);
}

/** Centre-cropped square, size×size. */
async function square(src, size) {
  const side = Math.min(src.width, src.height);
  const sx = (src.width - side) / 2;
  const sy = (src.height - side) / 2;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, side, side, 0, 0, size, size);
  return toBlob(c);
}

/** → { 1200: Blob, 400: Blob } */
export async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPG, PNG or WebP).');
  const src = await decode(file);
  const [large, thumb] = await Promise.all([fit(src, 1200), square(src, 400)]);
  src.close?.();
  return { 1200: large, 400: thumb };
}
