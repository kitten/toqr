const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  GF_EXP[i] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) {
  GF_EXP[i] = GF_EXP[i - 255];
}

const gmul = (a: number, b: number): number =>
  a > 0 && b > 0 ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0;

const gpow = (x: number, pow: number): number =>
  GF_EXP[(pow * GF_LOG[x]) % 255];

const genRS = (degree: number): Uint8Array => {
  const scratch = new Uint8Array(degree + 2);
  const gen = new Uint8Array(degree + 1);
  gen[0] = 1;
  for (let i = 0; i < degree; i++) {
    const alpha = gpow(2, i);
    scratch.fill(0, 0, i + 2);
    for (let j = 0; j < i + 1; j++) {
      scratch[j] ^= gen[j];
      scratch[j + 1] ^= gmul(gen[j], alpha);
    }
    for (let j = 0; j < i + 2; j++) {
      gen[j] = scratch[j];
    }
  }
  return gen;
};

export const encodeRS = (input: Uint8Array, degree: number) => {
  const gen = genRS(degree);
  const output = new Uint8Array(input.byteLength + gen.byteLength - 1);
  output.set(input);
  for (let i = 0; i < input.byteLength; i++) {
    const coef = output[i];
    if (coef) {
      for (let j = 1; j < gen.byteLength; j++) {
        output[i + j] ^= gmul(gen[j], coef);
      }
    }
  }
  return output.subarray(input.byteLength);
};
