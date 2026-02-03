const getChar = (p: number): string => {
  // Invert then reverse
  let char = p ^ 0b111111;
  char = ((char & 0xaa) >> 1) | ((char & 0x55) << 1);
  char = ((char & 0xcc) >> 2) | ((char & 0x33) << 2);
  char = (char >> 4) | (char << 4);
  char = (char >> 2) & 63;
  switch (char) {
    case 0:
      return ' ';
    case 63:
      return '\u2588';
    case 21:
      return '\u258C';
    case 42:
      return '\u2590';
    default:
      return String.fromCodePoint(
        0x1fb00 + char - 1 - (char > 21 ? 1 : 0) - (char > 42 ? 1 : 0)
      );
  }
};

export const print = (
  data: Uint8Array,
  extent = Math.sqrt(data.byteLength) | 0
) => {
  const padded = extent + 2;
  let output = '';

  for (let baseRow = 0; baseRow < padded; baseRow += 3) {
    if (baseRow) output += '\n';

    for (let baseCol = 0; baseCol < padded; baseCol += 2) {
      let p = 0;

      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 2; dc++) {
          const r = baseRow + dr;
          const c = baseCol + dc;
          const bit = 5 - (dr * 2 + dc);

          let cell = 1; // default empty (out of bounds)
          if (r < padded && c < padded) {
            if (r === 0 || c === 0 || r === padded - 1 || c === padded - 1) {
              cell = 0; // border is filled
            } else if (r <= extent && c <= extent) {
              cell = data[(r - 1) * extent + (c - 1)];
            }
          }

          p |= (cell & 1) << bit;
        }
      }

      output += getChar(p);
    }
  }

  console.log(output);
};
