export type ImageSize = { width: number; height: number };

/** cover 会按较大比例缩放；按设备像素核对，避免宽度足够但高度不足仍被放大。 */
export function fitsArtwork(image: ImageSize, box: ImageSize, pixelRatio: number) {
  return image.width > 0 && image.height > 0 && box.width > 0 && box.height > 0 &&
    Math.max(box.width / image.width, box.height / image.height) * Math.max(1, pixelRatio) <= 1;
}

/** 横幅必须为横图，竖海报不进入 PC 通栏背景。 */
export function fitsBackdrop(image: ImageSize, box: ImageSize, pixelRatio: number) {
  return image.width > image.height && fitsArtwork(image, box, pixelRatio);
}
