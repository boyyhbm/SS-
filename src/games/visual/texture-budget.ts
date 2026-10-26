import * as THREE from 'three';
// Applied before the first GPU upload, never during driving. Dropping authored
// top mip levels reduces residency without resampling normal/data maps or
// allocating a replacement image. Texture data/color-space semantics are kept.
export function prepareTexture(texture: THREE.Texture, maxSize: number, anisotropy: number) {
  if (texture instanceof THREE.CompressedTexture) {
    while (
      texture.mipmaps.length > 1 &&
      Math.max(texture.image.width, texture.image.height) > maxSize
    ) {
      texture.mipmaps.shift();
      const first = texture.mipmaps[0];
      texture.image.width = first.width;
      texture.image.height = first.height;
    }
  }
  texture.anisotropy = anisotropy;
}
