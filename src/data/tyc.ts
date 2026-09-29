/** Packed TYC id encoding shared with scripts/build-stars.ts output. */

export function unpackTyc(id: number): [number, number, number] {
  return [(id >> 16) & 0x3fff, (id >> 2) & 0x3fff, (id & 3) + 1];
}

export function tycCode(id: number): string {
  const [a, b, c] = unpackTyc(id);
  return `${a}-${b}-${c}`;
}
