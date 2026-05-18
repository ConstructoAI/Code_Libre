/**
 * Compression d'images cote client via canvas.toBlob (zero dependance).
 *
 * Utile sur le terrain : photos brutes 5-15 MB depuis camera mobile,
 * comprimees a ~500 KB avant upload pour economiser la data 3G/4G.
 *
 * Limitation : pas de preservation EXIF (canvas re-encode). Si on a besoin
 * des metadata GPS, il faut les extraire AVANT compression et les renvoyer
 * dans un champ separe (ex: FormData 'exif'). Pour le MVP, le serveur
 * extrait EXIF via Pillow sur les images NON compressees (passthrough <500 KB).
 */

export interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  wasCompressed: boolean;
}

export interface CompressionOptions {
  /** Largeur/hauteur max (default 1920). L'aspect ratio est preserve. */
  maxWidthOrHeight?: number;
  /** Qualite JPEG/WebP (0-1, default 0.85). */
  quality?: number;
  /** Format de sortie (default 'image/jpeg'). Le navigateur peut ne pas
   *  supporter image/webp en toBlob — fallback transparent. */
  outputType?: 'image/jpeg' | 'image/webp';
  /** Seuil sous lequel on ne compresse pas (default 500 KB). */
  skipBelowBytes?: number;
}

const DEFAULTS: Required<CompressionOptions> = {
  maxWidthOrHeight: 1920,
  quality: 0.85,
  outputType: 'image/jpeg',
  skipBelowBytes: 500 * 1024,
};

export async function compressImageIfNeeded(
  file: File,
  opts: CompressionOptions = {},
): Promise<CompressionResult> {
  const cfg = { ...DEFAULTS, ...opts };
  const originalSize = file.size;
  const passthrough = (reason: string): CompressionResult => {
    return { file, originalSize, compressedSize: originalSize, ratio: 1, wasCompressed: false };
  };

  if (!file.type.startsWith('image/')) return passthrough('not-image');
  if (file.type === 'image/svg+xml') return passthrough('svg-no-raster');
  if (originalSize < cfg.skipBelowBytes) return passthrough('below-threshold');

  try {
    const dataUrl = await fileToDataUrl(file);
    const img = await loadImage(dataUrl);

    const { width, height } = computeResizedDimensions(
      img.naturalWidth, img.naturalHeight, cfg.maxWidthOrHeight,
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return passthrough('no-canvas-ctx');
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, cfg.outputType, cfg.quality);
    if (!blob || blob.size >= originalSize) {
      // Compression sans effet (deja optimise) → passthrough
      return passthrough('compressed-bigger-than-original');
    }

    // Nouveau nom: garder le base mais switcher extension
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const ext = cfg.outputType === 'image/webp' ? 'webp' : 'jpg';
    const newFile = new File([blob], `${baseName}.${ext}`, {
      type: cfg.outputType,
      lastModified: file.lastModified,
    });

    return {
      file: newFile,
      originalSize,
      compressedSize: blob.size,
      ratio: blob.size / originalSize,
      wasCompressed: true,
    };
  } catch (err) {
    // En cas d'erreur (memoire, decode), on retourne le fichier original
    // sans bloquer l'upload — best effort.
    // eslint-disable-next-line no-console
    console.warn('[imageCompression] fallback to original:', err);
    return passthrough('error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function computeResizedDimensions(
  origWidth: number,
  origHeight: number,
  maxDim: number,
): { width: number; height: number } {
  if (origWidth <= maxDim && origHeight <= maxDim) {
    return { width: origWidth, height: origHeight };
  }
  if (origWidth > origHeight) {
    const ratio = maxDim / origWidth;
    return { width: maxDim, height: Math.round(origHeight * ratio) };
  }
  const ratio = maxDim / origHeight;
  return { width: Math.round(origWidth * ratio), height: maxDim };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}
