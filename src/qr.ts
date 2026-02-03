import { encodeRS } from './rs';
import {
  sizeByVersion,
  ecSizeByVersion,
  ecBlocksByVersion,
  extentByVersion,
  alignmentCoordsByVersion,
} from './constants';

type MaskPattern = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const enum ECLevel {
  M = 0,
  L = 1,
  H = 2,
  Q = 3,
}

const BYTE_MODE = 0b0100;

/** Convert input data to output data format with metadata */
const makeSegments = (data: Uint8Array, version: number, ec: ECLevel) => {
  const capacity = sizeByVersion[version] - ecSizeByVersion[version][ec];
  const segment = new Uint8Array(capacity);
  // NOTE: We're skipping 0b0111 (eci), 0x1A (utf8), since just encoding 0b0111
  // is sufficient for the raw bytes mode, and just skips the explicit UTF-8 flag
  // This saves one byte here, and one byte in the padding
  let carry = 0;
  let idx = 0;
  if (version > 9) {
    // For higher versions, lengths must be stored as two bytes
    // These bytes are split into 4 bit chunks, since we're byte-misaligned
    const length = data.byteLength & 65535;
    segment[0] = (BYTE_MODE << 4) | ((length >>> 12) & 0xf);
    segment[1] = (length >>> 4) & 0xff;
    carry = (length & 0xf) << 4;
    idx = 2;
  } else {
    // For smaller versions, lengths are stored as a single byte
    const length = data.byteLength & 255;
    segment[0] = (BYTE_MODE << 4) | ((length >>> 4) & 0xf);
    carry = (length & 0xf) << 4;
    idx = 1;
  }
  // Write two bytes at once, shifting them by the 4-bit misalignment
  let byteIdx = 0;
  while (byteIdx + 1 < data.byteLength) {
    const double = (data[byteIdx++] << 8) | data[byteIdx++];
    segment[idx++] = carry | (double >>> 12);
    segment[idx++] = (double >>> 4) & 0xff;
    carry = (double << 4) & 0xf0;
  }
  // Write leftover byte, if we have an odd number of bytes
  if (byteIdx < data.byteLength) {
    segment[idx++] = carry | (data[byteIdx] >>> 4);
    carry = (data[byteIdx] << 4) & 0xf0;
  }
  // Write the leftover 4-bit sequence
  // This also skips the 4 terminator bits
  segment[idx++] = carry;
  // Pad with 0xEC, 0x11 alternating
  for (let j = 0; idx < capacity; j++)
    segment[idx++] = j & 1 ? 0b00010001 : 0b11101100;
  return segment;
};

/** Returns the best QR version to use (0-40) */
const getBestVersion = (data: Uint8Array, ec: ECLevel): number => {
  for (let version = 1; version <= 40; version++) {
    let capacity = sizeByVersion[version] - ecSizeByVersion[version][ec];
    // Adjust by the prefix, 1/2 bytes for size, 1 byte for terminator and padding
    capacity -= version > 9 ? 3 : 2;
    if (capacity >= data.byteLength) return version;
  }
  // NOTE: The QR generator can throw, if we're overflowing the max data length
  throw new RangeError('Bytes exceed max length');
};

/** Interleaves data from DC blocks then data from EC blocks */
const interleave = (
  byteLength: number,
  dcs: Uint8Array[],
  ecs: Uint8Array[]
): Uint8Array => {
  //let byteLength = 0;
  let maxY = 0;
  // Get the maximum of length of DC blocks and add up byte length
  for (let i = 0; i < dcs.length; i++) {
    maxY = maxY < dcs[i].byteLength ? dcs[i].byteLength : maxY;
  }
  // Add bytes from DCs, alternating blocks each time
  const buffer = new Uint8Array(byteLength);
  let idx = 0;
  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < dcs.length; x++) {
      if (y < dcs[x].byteLength) {
        buffer[idx++] = dcs[x][y];
      }
    }
  }
  // Add bytes from ECs, alternating blocks each time
  for (let y = 0, maxY = ecs[0].byteLength; y < maxY; y++) {
    for (let x = 0; x < ecs.length; x++) {
      buffer[idx++] = ecs[x][y];
    }
  }
  return buffer;
};

/** Encode segments output data into interleaved QR data with EC */
const encodeData = (segments: Uint8Array, version: number, ec: ECLevel) => {
  const byteLength = segments.byteLength + ecSizeByVersion[version][ec];
  const numBlocks = ecBlocksByVersion[version][ec];
  const splitIdx = numBlocks - (byteLength % numBlocks);
  const blockLength = (segments.byteLength / numBlocks) | 0;
  const ecCount = ((byteLength / numBlocks) | 0) - blockLength;
  // We assemble EC blocks for each DC block
  const dcs: Uint8Array[] = new Array(numBlocks);
  const ecs: Uint8Array[] = new Array(numBlocks);
  for (let idx = 0, offset = 0; idx < numBlocks; idx++) {
    const dataSize = idx < splitIdx ? blockLength : blockLength + 1;
    const dc = (dcs[idx] = segments.subarray(offset, (offset += dataSize)));
    ecs[idx] = encodeRS(dc, ecCount);
  }
  // Interleave the DCs and then the ECs
  return interleave(byteLength, dcs, ecs);
};

/** Draw plain square */
const setSquare = (
  pixels: Uint8Array,
  extent: number,
  row: number,
  col: number,
  size: number
) => {
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      pixels[(row + i) * extent + (col + j)] = 1;
    }
  }
};

/** Draw square with inset border of 0 bits pattern */
const setPattern = (
  pixels: Uint8Array,
  extent: number,
  row: number,
  col: number,
  size: number
) => {
  const base = row * extent + col;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // We draw the inner border by computing distance to the outer ring
      const dx = x < size - 1 - x ? x : size - 1 - x;
      const dy = y < size - 1 - y ? y : size - 1 - y;
      // If we're 1 pixel away from the outer size we set 0
      const d = dx < dy ? dx : dy;
      pixels[base + y * extent + x] = d !== 1 ? 1 : 0;
    }
  }
};

const FINDER_PATTERN_SIZE = 7;

/** Write patterns in top left, top right, and bottom left corners */
const writeFinderPatterns = (
  pixels: Uint8Array,
  reserved: Uint8Array,
  extent: number
) => {
  const end = extent - FINDER_PATTERN_SIZE;
  setPattern(pixels, extent, 0, 0, FINDER_PATTERN_SIZE);
  setPattern(pixels, extent, end, 0, FINDER_PATTERN_SIZE);
  setPattern(pixels, extent, 0, end, FINDER_PATTERN_SIZE);
  setSquare(reserved, extent, 0, 0, FINDER_PATTERN_SIZE + 1);
  setSquare(reserved, extent, end - 1, 0, FINDER_PATTERN_SIZE + 1);
  setSquare(reserved, extent, 0, end - 1, FINDER_PATTERN_SIZE + 1);
};

/** Write alignment patterns in the remaining inset corners */
const writeAlignmentPatterns = (
  pixels: Uint8Array,
  reserved: Uint8Array,
  extent: number,
  version: number
) => {
  const ALIGNMENT_PATTERN_SIZE = 5;
  const coords = alignmentCoordsByVersion[version];
  for (let i = 0; i < coords.length; i++) {
    const row = coords[i];
    for (let j = 0; j < coords.length; j++) {
      // We know that the same corners for the finder patterns will
      // conflict with the alignment patterns, so we can hard-code skip indices
      if ((i || j % (coords.length - 1)) && (j || i % (coords.length - 1))) {
        const col = coords[j];
        setPattern(pixels, extent, row, col, ALIGNMENT_PATTERN_SIZE);
        setSquare(reserved, extent, row, col, ALIGNMENT_PATTERN_SIZE);
      }
    }
  }
};

/** Write alternating 1/0 stripes horizontally and vertically on finder pattern positions */
const writeTimingPatterns = (
  pixels: Uint8Array,
  reserved: Uint8Array,
  extent: number
) => {
  const offset = FINDER_PATTERN_SIZE - 1;
  const start = FINDER_PATTERN_SIZE + 1;
  const end = extent - FINDER_PATTERN_SIZE;
  for (let idx = start; idx < end; idx++) {
    const y = idx * extent + offset;
    if (!reserved[y]) {
      reserved[y] = 1;
      pixels[y] = (idx + 1) % 2;
    }
    const x = offset * extent + idx;
    if (!reserved[x]) {
      reserved[x] = 1;
      pixels[x] = (idx + 1) % 2;
    }
  }
};

/** Reserve corner pixels for format information */
const reserveFormatInfo = (reserved: Uint8Array, extent: number) => {
  const offset = FINDER_PATTERN_SIZE + 1;
  const end = extent - FINDER_PATTERN_SIZE - 1;
  reserved[offset * extent + offset] = 1;
  for (let idx = 0; idx < offset; idx++) {
    reserved[idx * extent + offset] = 1;
    reserved[offset * extent + idx] = 1;
    reserved[(end + idx) * extent + offset] = 1;
    reserved[offset * extent + end + idx] = 1;
  }
};

/** Reserve space 6x3 space next to top-right and bottom-left finder pattern */
const reserveVersionInfo = (
  reserved: Uint8Array,
  extent: number,
  version: number
) => {
  if (version >= 7) {
    const end = extent - FINDER_PATTERN_SIZE - 4;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[(end + j) * extent + i] = 1;
        reserved[i * extent + end + j] = 1;
      }
    }
  }
};

/** Write encoded data to pixel output */
const writeData = (
  pixels: Uint8Array,
  reserved: Uint8Array,
  extent: number,
  data: Uint8Array
) => {
  let idx = 0;
  let col = extent - 1;
  let direction = -1;
  let shift = 7;
  while (idx < data.byteLength) {
    if (col === FINDER_PATTERN_SIZE - 1) col--;
    for (let row = 0; row < extent; row++) {
      for (let dc = 0; dc < 2; dc++) {
        // The direction of written pixels switches back and forth
        const c = col - dc;
        const r = direction === -1 ? extent - row - 1 : row;
        if (reserved[r * extent + c]) continue;
        const bit = (data[idx] >>> shift) & 1;
        // We're shifting in bits from the data byte, for 8 bits,
        // once we're exhausting the byte, we're incrementing
        pixels[r * extent + c] = bit;
        if (shift-- === 0) {
          shift = 7;
          if (++idx >= data.byteLength) return;
        }
      }
    }
    direction = -direction;
    col -= 2;
  }
};

/** XOR the mask pattern onto the pixels on unreserved bits */
const xorPattern = (
  pixels: Uint8Array,
  reserved: Uint8Array,
  extent: number,
  pattern: MaskPattern
) => {
  for (let row = 0; row < extent; row++) {
    for (let col = 0; col < extent; col++) {
      if (!reserved[row * extent + col]) {
        let bit: boolean;
        switch (pattern) {
          case 0:
            bit = (row + col) % 2 === 0;
            break;
          case 1:
            bit = row % 2 === 0;
            break;
          case 2:
            bit = col % 3 === 0;
            break;
          case 3:
            bit = (row + col) % 3 === 0;
            break;
          case 4:
            bit = (((row / 2) | 0) + ((col / 3) | 0)) % 2 === 0;
            break;
          case 5:
            bit = ((row * col) % 2) + ((row * col) % 3) === 0;
            break;
          case 6:
            bit = (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
            break;
          case 7:
            bit = (((row * col) % 3) + ((row + col) % 2)) % 2 === 0;
            break;
        }
        pixels[row * extent + col] ^= bit ? 1 : 0;
      }
    }
  }
};

/** Penalty for 5 adjacent consecutive bits */
const computePenaltyN1 = (pixels: Uint8Array, extent: number): number => {
  const PENALTY_WEIGHT_N1 = 3;
  let penalty = 0;
  for (let row = 0; row < extent; row++) {
    let rowNumSame = 1;
    let colNumSame = 1;
    for (let col = 1; col < extent; col++) {
      if (pixels[row * extent + col - 1] === pixels[row * extent + col]) {
        rowNumSame++;
      } else {
        if (rowNumSame >= 5) penalty += PENALTY_WEIGHT_N1 + (rowNumSame - 5);
        rowNumSame = 1;
      }
      if (pixels[(col - 1) * extent + row] === pixels[col * extent + row]) {
        colNumSame++;
      } else {
        if (colNumSame >= 5) penalty += PENALTY_WEIGHT_N1 + (colNumSame - 5);
        colNumSame = 1;
      }
    }
    if (rowNumSame >= 5) penalty += PENALTY_WEIGHT_N1 + (rowNumSame - 5);
    if (colNumSame >= 5) penalty += PENALTY_WEIGHT_N1 + (colNumSame - 5);
  }
  return penalty;
};

/** Penalty for amount of 2x2 squares */
const computePenaltyN2 = (pixels: Uint8Array, extent: number): number => {
  const PENALTY_WEIGHT_N2 = 3;
  let penalty = 0;
  for (let row = 0; row < extent - 1; row++) {
    for (let col = 0; col < extent - 1; col++) {
      if (
        pixels[row * extent + col] === pixels[row * extent + col + 1] &&
        pixels[row * extent + col] === pixels[(row + 1) * extent + col] &&
        pixels[row * extent + col] === pixels[(row + 1) * extent + col + 1]
      ) {
        penalty += PENALTY_WEIGHT_N2;
      }
    }
  }
  return penalty;
};

/** Penalty for finder-like patterns (0b000010001 / 0b100010000) */
const computePenaltyN3 = (pixels: Uint8Array, extent: number): number => {
  const PENALTY_WEIGHT_N3 = 40;
  let penalty = 0;
  for (let i = 0; i < extent; i++) {
    let row = 0;
    let col = 0;
    for (let j = 0; j < extent; j++) {
      row = ((row << 1) & 0x7ff) | pixels[i * extent + j];
      if (j >= 10 && (row === 0x5d0 || row === 0x05d))
        penalty += PENALTY_WEIGHT_N3;
      col = ((col << 1) & 0x7ff) | pixels[j * extent + i];
      if (j >= 10 && (col === 0x5d0 || col === 0x05d))
        penalty += PENALTY_WEIGHT_N3;
    }
  }
  return penalty;
};

/** Penalty if ratio of unset bits is too high */
const computePenaltyN4 = (pixels: Uint8Array, extent: number): number => {
  const PENALTY_WEIGHT_N4 = 10;
  let darkBits = 0;
  for (let row = 0; row < extent; row++)
    for (let col = 0; col < extent; col++)
      darkBits += pixels[row * extent + col] & 1;
  const fraction = darkBits / pixels.byteLength;
  const increment = Math.abs(fraction - 0.5) * 100;
  return PENALTY_WEIGHT_N4 * Math.floor(increment / 5);
};

const applyBestPattern = (
  pixels: Uint8Array,
  reserved: Uint8Array,
  extent: number
): MaskPattern => {
  let minPenalty = 0;
  let bestPattern: MaskPattern = 0;
  for (
    let pattern: MaskPattern = 0;
    pattern <= 7;
    pattern = (pattern + 1) as MaskPattern
  ) {
    xorPattern(pixels, reserved, extent, pattern);
    const penalty =
      computePenaltyN1(pixels, extent) +
      computePenaltyN2(pixels, extent) +
      computePenaltyN3(pixels, extent) +
      computePenaltyN4(pixels, extent);
    if (pattern === 0 || penalty < minPenalty) {
      minPenalty = penalty;
      bestPattern = pattern;
    }
    // Micro-opt: We can skip a triple-XOR if the final pattern is the best
    if (pattern === 7 && bestPattern === 7) return 7;
    // Undo the pattern by applying XOR again
    xorPattern(pixels, reserved, extent, pattern);
  }
  xorPattern(pixels, reserved, extent, bestPattern);
  return bestPattern;
};

/** Encode format with mask into 15 bit format info */
const encodeFormatInfo = (ec: ECLevel, mask: MaskPattern) => {
  const FORMAT_INFO_GENERATOR = 0x537;
  const FORMAT_INFO_MASK = 0b101010000010010;
  const format = ((ec << 3) | mask) << 10;
  let result = format;
  for (let shift = 0; shift < 5; shift++) {
    const mask = 1 << (14 - shift);
    if (result & mask) result ^= FORMAT_INFO_GENERATOR << (4 - shift);
  }
  return (result | format) ^ FORMAT_INFO_MASK;
};

/** Write format info into reserved output zones */
const writeFormatInfo = (
  pixels: Uint8Array,
  extent: number,
  ec: ECLevel,
  mask: MaskPattern
) => {
  const format = encodeFormatInfo(ec, mask); // 15 bit format info
  // Top left
  let shift = 14;
  for (let i = 0; i < 6; i++) pixels[8 * extent + i] = (format >> shift--) & 1;
  pixels[8 * extent + 7] = (format >> shift--) & 1;
  pixels[8 * extent + 8] = (format >> shift--) & 1;
  pixels[7 * extent + 8] = (format >> shift--) & 1;
  for (let i = 0; i < 6; i++)
    pixels[(5 - i) * extent + 8] = (format >> shift--) & 1;
  // Other corners
  shift = 14;
  for (let i = 0; i < 7; i++)
    pixels[(extent - 1 - i) * extent + 8] = (format >> shift--) & 1;
  pixels[(extent - 8) * extent + 8] = 1;
  for (let i = 0; i < 8; i++)
    pixels[8 * extent + extent - 8 + i] = (format >> shift--) & 1;
};

/** Encode version into 18 bit version info */
const encodeVersionInfo = (version: number) => {
  const VERSION_INFO_GENERATOR = 0x1f25;
  const format = version << 12;
  let result = format;
  for (let shift = 0; shift < 6; shift++) {
    const mask = 1 << (17 - shift);
    if (result & mask) result ^= VERSION_INFO_GENERATOR << (5 - shift);
  }
  return result | format;
};

/** Write version info into reserved output zones */
const writeVersionInfo = (
  pixels: Uint8Array,
  extent: number,
  version: number
) => {
  if (version >= 7) {
    const format = encodeVersionInfo(version);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const bit = (format >>> (i * 3 + j)) & 1;
        pixels[(extent - 11 + j) * extent + i] = bit; // Lower left
        pixels[i * extent + extent - 11 + j] = bit; // Upper right
      }
    }
  }
};

const encodeBytes = (input: Uint8Array, ec: ECLevel) => {
  const version = getBestVersion(input, ec);
  const segments = makeSegments(input, version, ec);
  const data = encodeData(segments, version, ec);

  const extent = extentByVersion[version];
  const pixels = new Uint8Array(extent * extent);
  const reserved = new Uint8Array(extent * extent);

  writeFinderPatterns(pixels, reserved, extent);
  writeAlignmentPatterns(pixels, reserved, extent, version);
  writeTimingPatterns(pixels, reserved, extent);
  reserveFormatInfo(reserved, extent);
  reserveVersionInfo(reserved, extent, version);

  writeData(pixels, reserved, extent, data);

  const mask = applyBestPattern(pixels, reserved, extent);

  writeFormatInfo(pixels, extent, ec, mask);
  writeVersionInfo(pixels, extent, version);

  return pixels;
};

const encoder = new TextEncoder();

export const toQR = (content: string | Uint8Array, ec = ECLevel.L) => {
  const data = typeof content === 'string' ? encoder.encode(content) : content;
  return encodeBytes(data, ec);
};

export {
  makeSegments as _makeSegments,
  getBestVersion as _getBestVersion,
  interleave as _interleave,
  encodeData as _encodeData,
  writeFinderPatterns as _writeFinderPatterns,
  writeAlignmentPatterns as _writeAlignmentPatterns,
  writeTimingPatterns as _writeTimingPatterns,
  reserveFormatInfo as _reserveFormatInfo,
  reserveVersionInfo as _reserveVersionInfo,
  writeData as _writeData,
  xorPattern as _xorPattern,
  computePenaltyN1 as _computePenaltyN1,
  computePenaltyN2 as _computePenaltyN2,
  computePenaltyN3 as _computePenaltyN3,
  computePenaltyN4 as _computePenaltyN4,
  applyBestPattern as _applyBestPattern,
  encodeFormatInfo as _encodeFormatInfo,
  writeFormatInfo as _writeFormatInfo,
  encodeVersionInfo as _encodeVersionInfo,
  writeVersionInfo as _writeVersionInfo,
};
