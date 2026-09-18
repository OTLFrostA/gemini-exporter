// src/core/engine/screenshotStitcher.ts - Long Screenshot Stitching Engine
export interface CapturedFrame {
    dataUrl: string;
    scrollTop: number;
    viewportHeight: number;
    viewportWidth?: number;
}

export interface StitchOptions {
    frames: CapturedFrame[];
    totalHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio?: number;
    maxCanvasHeight?: number;
    targetScale?: number;
}

export interface StitchResult {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    dataUrl: string;
    blob: Blob | null;
}

export interface FrameLayout {
    sourceY: number;
    sourceHeight: number;
    destY: number;
    destHeight: number;
}

/**
 * Calculates non-overlapping layout slices for a sequence of scroll-captured frames.
 * Prevents repeating content when frames overlap.
 */
export function calculateFrameLayouts(
    frames: { scrollTop: number; viewportHeight: number }[],
    totalContentHeight: number
): FrameLayout[] {
    if (!frames.length) return [];

    const layouts: FrameLayout[] = [];
    let currentPaintedY = 0;

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const frameTop = frame.scrollTop;
        const frameHeight = frame.viewportHeight;

        let sourceY = 0;
        let destY = frameTop;
        let sliceHeight = frameHeight;

        if (i === 0) {
            // First frame: paint from 0 up to frameHeight
            currentPaintedY = frameHeight;
            layouts.push({
                sourceY: 0,
                sourceHeight: frameHeight,
                destY: 0,
                destHeight: frameHeight
            });
            continue;
        }

        // If this frame overlaps with already painted content, take only the delta
        if (frameTop < currentPaintedY) {
            const overlap = currentPaintedY - frameTop;
            if (overlap >= frameHeight) {
                // Completely covered by previous frame, skip
                continue;
            }
            sourceY = overlap;
            destY = currentPaintedY;
            sliceHeight = frameHeight - overlap;
        } else {
            destY = frameTop;
        }

        // Clamp to total content height if specified
        if (destY + sliceHeight > totalContentHeight) {
            sliceHeight = Math.max(0, totalContentHeight - destY);
        }

        if (sliceHeight > 0) {
            layouts.push({
                sourceY,
                sourceHeight: sliceHeight,
                destY,
                destHeight: sliceHeight
            });
            currentPaintedY = destY + sliceHeight;
        }
    }

    return layouts;
}

/**
 * Helper to load an HTMLImageElement from a data URL.
 */
export function loadImageAsync(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error('Failed to load image frame: ' + e));
        img.src = dataUrl;
    });
}

/**
 * Stitches captured frames into a single long screenshot Canvas.
 */
export async function stitchFrames(opts: StitchOptions): Promise<StitchResult> {
    const {
        frames,
        totalHeight,
        viewportWidth,
        viewportHeight,
        devicePixelRatio = 1,
        maxCanvasHeight = 24000,
        targetScale = 1
    } = opts;

    if (!frames.length) {
        throw new Error('No frames provided for stitching');
    }

    const layouts = calculateFrameLayouts(frames, totalHeight);
    if (!layouts.length) {
        throw new Error('No valid layout slices generated');
    }

    // Determine final canvas height, clamped to safe hardware boundary
    const effectiveHeight = Math.min(totalHeight, maxCanvasHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewportWidth * targetScale);
    canvas.height = Math.round(effectiveHeight * targetScale);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Canvas 2D context unavailable');
    }

    // Set high-quality image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Load and draw each frame onto the canvas
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const layout = layouts[i];
        if (!layout) continue;

        const img = await loadImageAsync(frame.dataUrl);

        // Calculate native source coordinates accounting for devicePixelRatio
        const dpr = img.naturalWidth / viewportWidth || devicePixelRatio || 1;
        const sx = 0;
        const sy = Math.round(layout.sourceY * dpr);
        const sWidth = Math.round(viewportWidth * dpr);
        const sHeight = Math.round(layout.sourceHeight * dpr);

        const dx = 0;
        const dy = Math.round(layout.destY * targetScale);
        const dWidth = Math.round(viewportWidth * targetScale);
        const dHeight = Math.round(layout.destHeight * targetScale);

        ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
    }

    const dataUrl = canvas.toDataURL('image/png', 0.95);
    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png', 0.95);
    });

    return {
        canvas,
        width: canvas.width,
        height: canvas.height,
        dataUrl,
        blob
    };
}

export const ScreenshotStitcher = {
    calculateFrameLayouts,
    stitchFrames,
    loadImageAsync
};

export default ScreenshotStitcher;
