import { describe, it, expect } from 'vitest';
import {
  toQR,
  _makeSegments,
  _getBestVersion,
  _encodeData,
  _writeFinderPatterns,
  _writeAlignmentPatterns,
  _writeTimingPatterns,
  _reserveFormatInfo,
  _reserveVersionInfo,
  _writeData,
  _xorPattern,
  _computePenalty,
  _applyBestPattern,
  _encodeFormatInfo,
  _writeFormatInfo,
  _encodeVersionInfo,
  _writeVersionInfo,
} from '../qr';
import { extentByVersion, alignmentCoordsByVersion } from '../constants';

const pixelsToGrid = (pixels: Uint8Array, extent: number): string => {
  const rows: string[] = [];
  for (let r = 0; r < extent; r++) {
    let row = '';
    for (let c = 0; c < extent; c++) {
      row += pixels[r * extent + c] ? '█' : ' ';
    }
    rows.push(row);
  }
  return rows.join('\n');
};

describe('toQR', () => {
  it('encodes a simple string', () => {
    const result = toQR('Hello');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(441);
  });

  it('encodes a Uint8Array', () => {
    const input = new Uint8Array([72, 101, 108, 108, 111]);
    const result = toQR(input);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(toQR('Hello'));
  });

  it('produces a square output', () => {
    const result = toQR('Test');
    const side = Math.sqrt(result.length);
    expect(side).toBe(Math.floor(side));
    expect(side).toBe(21);
  });

  it('produces larger output for longer strings', () => {
    const short = toQR('Hi');
    const long = toQR('This is a much longer string that requires more space');
    expect(short.length).toBe(441);
    expect(long.length).toBe(841);
  });

  it('snapshot: Hello', () => {
    const result = toQR('Hello');
    const extent = Math.sqrt(result.length);
    expect(pixelsToGrid(result, extent)).toMatchSnapshot();
  });

  it('snapshot: URL', () => {
    const result = toQR('https://example.com');
    const extent = Math.sqrt(result.length);
    expect(pixelsToGrid(result, extent)).toMatchSnapshot();
  });

  it('snapshot: numeric', () => {
    const result = toQR('1234567890');
    const extent = Math.sqrt(result.length);
    expect(pixelsToGrid(result, extent)).toMatchSnapshot();
  });
});

describe('_getBestVersion', () => {
  it('returns version 1 for short data', () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(_getBestVersion(data, 1)).toBe(1);
  });

  it('returns version 2 for 18 bytes with EC level L', () => {
    const data = new Uint8Array(18);
    expect(_getBestVersion(data, 1)).toBe(2);
  });

  it('returns version 3 for 33 bytes with EC level L', () => {
    const data = new Uint8Array(33);
    expect(_getBestVersion(data, 1)).toBe(3);
  });

  it('returns higher version for longer data', () => {
    const data = new Uint8Array(50);
    expect(_getBestVersion(data, 1)).toBe(3);
  });

  it('returns higher versions for stricter EC levels', () => {
    const data = new Uint8Array(50);
    const versionL = _getBestVersion(data, 1);
    const versionM = _getBestVersion(data, 0);
    const versionH = _getBestVersion(data, 2);
    expect(versionL).toBeLessThanOrEqual(versionM);
    expect(versionM).toBeLessThanOrEqual(versionH);
  });

  it('throws for data exceeding max length', () => {
    const data = new Uint8Array(5000);
    expect(() => _getBestVersion(data, 1)).toThrow(RangeError);
  });
});

describe('_makeSegments', () => {
  it('creates segments with correct capacity for version 1', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const segments = _makeSegments(data, 1, 1);
    expect(segments.length).toBe(19);
  });

  it('creates segments with correct capacity for version 10', () => {
    const data = new Uint8Array(100);
    const segments = _makeSegments(data, 10, 1);
    expect(segments.length).toBe(274);
  });

  it('pads with alternating 0xEC and 0x11', () => {
    const data = new Uint8Array([1]);
    const segments = _makeSegments(data, 1, 1);
    const lastBytes = segments.slice(-4);
    expect(lastBytes[0]).toBe(0xec);
    expect(lastBytes[1]).toBe(0x11);
    expect(lastBytes[2]).toBe(0xec);
    expect(lastBytes[3]).toBe(0x11);
  });

  it('snapshot: Hello segments', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const segments = _makeSegments(data, 1, 1);
    expect(Array.from(segments)).toMatchSnapshot();
  });

  it('snapshot: longer data segments', () => {
    const data = new TextEncoder().encode('Test data 123');
    const segments = _makeSegments(data, 2, 1);
    expect(Array.from(segments)).toMatchSnapshot();
  });
});

describe('_encodeData', () => {
  it('returns data with EC bytes appended for version 1', () => {
    const data = new Uint8Array([0x40, 0x54, 0x65, 0x73, 0x74, 0x00]);
    const segments = _makeSegments(data, 1, 1);
    const result = _encodeData(segments, 1, 1);
    expect(result.length).toBe(26);
  });

  it('snapshot: encoded data for Hello', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const segments = _makeSegments(data, 1, 1);
    const result = _encodeData(segments, 1, 1);
    expect(Array.from(result)).toMatchSnapshot();
  });

  it('snapshot: encoded data for version 2', () => {
    const data = new TextEncoder().encode('Testing 123');
    const segments = _makeSegments(data, 2, 1);
    const result = _encodeData(segments, 2, 1);
    expect(Array.from(result)).toMatchSnapshot();
  });
});

describe('_writeFinderPatterns', () => {
  it('writes finder patterns in three corners', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeFinderPatterns(pixels, reserved, extent);

    expect(pixels[0]).toBe(1);
    expect(pixels[6]).toBe(1);
    expect(pixels[extent * 6]).toBe(1);
    expect(pixels[(extent - 1) * extent]).toBe(1);
    expect(pixels[extent - 7]).toBe(1);
  });

  it('marks area as reserved including separator', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeFinderPatterns(pixels, reserved, extent);

    expect(reserved[0]).toBe(1);
    expect(reserved[7]).toBe(1);
    expect(reserved[7 * extent]).toBe(1);
    expect(reserved[7 * extent + 7]).toBe(1);
  });

  it('snapshot: finder patterns for v1', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeFinderPatterns(pixels, reserved, extent);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });

  it('snapshot: finder patterns for v7', () => {
    const extent = extentByVersion[7];
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeFinderPatterns(pixels, reserved, extent);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });
});

describe('_writeAlignmentPatterns', () => {
  it('does not write patterns for version 1', () => {
    const version = 1;
    const extent = extentByVersion[version];
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeAlignmentPatterns(pixels, reserved, extent, version);
    expect(pixels.every(p => p === 0)).toBe(true);
  });

  it('writes alignment pattern for version 2', () => {
    const version = 2;
    const extent = extentByVersion[version];
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeAlignmentPatterns(pixels, reserved, extent, version);

    const coords = alignmentCoordsByVersion[version];
    const row = coords[coords.length - 1];
    const col = coords[coords.length - 1];
    expect(pixels[(row + 2) * extent + (col + 2)]).toBe(1);
  });

  it('snapshot: alignment patterns for v2', () => {
    const version = 2;
    const extent = extentByVersion[version];
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeAlignmentPatterns(pixels, reserved, extent, version);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });

  it('snapshot: alignment patterns for v7', () => {
    const version = 7;
    const extent = extentByVersion[version];
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeAlignmentPatterns(pixels, reserved, extent, version);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });
});

describe('_writeTimingPatterns', () => {
  it('writes alternating pattern on row 6', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeTimingPatterns(pixels, reserved, extent);

    for (let i = 8; i < 14; i++) {
      expect(pixels[6 * extent + i]).toBe((i + 1) % 2);
    }
  });

  it('writes alternating pattern on column 6', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeTimingPatterns(pixels, reserved, extent);

    for (let i = 8; i < 14; i++) {
      expect(pixels[i * extent + 6]).toBe((i + 1) % 2);
    }
  });

  it('snapshot: timing patterns for v1', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeTimingPatterns(pixels, reserved, extent);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });
});

describe('_reserveFormatInfo', () => {
  it('reserves format info areas', () => {
    const extent = 21;
    const reserved = new Uint8Array(extent * extent);
    _reserveFormatInfo(reserved, extent);

    expect(reserved[8 * extent + 8]).toBe(1);
    expect(reserved[8]).toBe(1);
    expect(reserved[8 * extent]).toBe(1);
  });

  it('snapshot: reserved format info areas', () => {
    const extent = 21;
    const reserved = new Uint8Array(extent * extent);
    _reserveFormatInfo(reserved, extent);
    expect(pixelsToGrid(reserved, extent)).toMatchSnapshot();
  });
});

describe('_reserveVersionInfo', () => {
  it('does not reserve for versions below 7', () => {
    const extent = extentByVersion[6];
    const reserved = new Uint8Array(extent * extent);
    _reserveVersionInfo(reserved, extent, 6);
    expect(reserved.every(r => r === 0)).toBe(true);
  });

  it('reserves version info for version 7+', () => {
    const extent = extentByVersion[7];
    const reserved = new Uint8Array(extent * extent);
    _reserveVersionInfo(reserved, extent, 7);

    const end = extent - 7 - 4;
    expect(reserved[end * extent]).toBe(1);
  });

  it('snapshot: reserved version info for v7', () => {
    const extent = extentByVersion[7];
    const reserved = new Uint8Array(extent * extent);
    _reserveVersionInfo(reserved, extent, 7);
    expect(pixelsToGrid(reserved, extent)).toMatchSnapshot();
  });
});

describe('_writeData', () => {
  it('writes data bits to unreserved areas', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    const data = new Uint8Array([0xff, 0x00, 0xaa]);

    _writeData(pixels, reserved, extent, data);

    let nonZero = 0;
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i]) nonZero++;
    }
    expect(nonZero).toBe(12);
  });

  it('respects reserved areas', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    reserved.fill(1, 0, 100);
    const data = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

    _writeData(pixels, reserved, extent, data);

    for (let i = 0; i < 100; i++) {
      expect(pixels[i]).toBe(0);
    }
  });

  it('snapshot: written data pattern', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    const data = new Uint8Array(26);
    data.fill(0xaa);

    _writeData(pixels, reserved, extent, data);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });
});

describe('_xorPattern', () => {
  it('applies pattern 0 correctly (checkerboard)', () => {
    const extent = 5;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);

    _xorPattern(pixels, reserved, extent, 0);

    expect(pixels[0]).toBe(1);
    expect(pixels[1]).toBe(0);
    expect(pixels[extent]).toBe(0);
    expect(pixels[extent + 1]).toBe(1);
  });

  it('applies pattern 1 correctly (horizontal stripes)', () => {
    const extent = 5;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);

    _xorPattern(pixels, reserved, extent, 1);

    expect(pixels[0]).toBe(1);
    expect(pixels[1]).toBe(1);
    expect(pixels[extent]).toBe(0);
    expect(pixels[extent + 1]).toBe(0);
  });

  it('applies pattern 2 correctly (vertical stripes)', () => {
    const extent = 6;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);

    _xorPattern(pixels, reserved, extent, 2);

    expect(pixels[0]).toBe(1);
    expect(pixels[1]).toBe(0);
    expect(pixels[2]).toBe(0);
    expect(pixels[3]).toBe(1);
  });

  it('does not modify reserved pixels', () => {
    const extent = 5;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    reserved[0] = 1;
    reserved[1] = 1;

    _xorPattern(pixels, reserved, extent, 0);

    expect(pixels[0]).toBe(0);
    expect(pixels[1]).toBe(0);
  });

  it('XOR twice returns to original', () => {
    const extent = 5;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    const original = new Uint8Array(pixels);

    _xorPattern(pixels, reserved, extent, 3);
    _xorPattern(pixels, reserved, extent, 3);

    expect(pixels).toEqual(original);
  });

  it('snapshot: all mask patterns', () => {
    const extent = 8;
    const results: string[] = [];
    for (let pattern = 0; pattern <= 7; pattern++) {
      const pixels = new Uint8Array(extent * extent);
      const reserved = new Uint8Array(extent * extent);
      _xorPattern(
        pixels,
        reserved,
        extent,
        pattern as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
      );
      results.push(`Pattern ${pattern}:\n${pixelsToGrid(pixels, extent)}`);
    }
    expect(results.join('\n\n')).toMatchSnapshot();
  });
});

describe('_computePenalty', () => {
  it('returns 0 for N1/N2 on properly alternating pattern', () => {
    // Alternating pattern has no consecutive runs or 2x2 blocks
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    for (let row = 0; row < extent; row++) {
      for (let col = 0; col < extent; col++) {
        pixels[row * extent + col] = (row + col) % 2;
      }
    }
    // 50% dark, so N4 is 0; alternating so N1/N2 are 0; no finder patterns so N3 is 0
    expect(_computePenalty(pixels, extent)).toBe(0);
  });

  it('adds N1 penalty for 5+ consecutive same bits in row', () => {
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    for (let row = 0; row < extent; row++) {
      for (let col = 0; col < extent; col++) {
        pixels[row * extent + col] = (row + col) % 2;
      }
    }
    // Create 5 consecutive 1s in first row
    pixels[0] = 1;
    pixels[1] = 1;
    pixels[2] = 1;
    pixels[3] = 1;
    pixels[4] = 1;
    // Should have at least N1 penalty of 3
    expect(_computePenalty(pixels, extent)).toBeGreaterThanOrEqual(3);
  });

  it('adds N1 penalty for 6 consecutive same bits', () => {
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    for (let row = 0; row < extent; row++) {
      for (let col = 0; col < extent; col++) {
        pixels[row * extent + col] = (row + col) % 2;
      }
    }
    for (let i = 0; i < 6; i++) pixels[i] = 1;
    // N1 penalty for 6 consecutive = 3 + (6-5) = 4
    expect(_computePenalty(pixels, extent)).toBe(4);
  });

  it('adds N1 penalties for both rows and columns', () => {
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    for (let row = 0; row < extent; row++) {
      for (let col = 0; col < extent; col++) {
        pixels[row * extent + col] = (row + col) % 2;
      }
    }
    for (let i = 0; i < 5; i++) pixels[i] = 1;
    for (let i = 0; i < 5; i++) pixels[i * extent] = 1;
    const penalty = _computePenalty(pixels, extent);
    // Should have penalties from both horizontal and vertical runs
    expect(penalty).toBeGreaterThanOrEqual(6);
  });

  it('adds N2 penalty for 2x2 blocks', () => {
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    for (let row = 0; row < extent; row++) {
      for (let col = 0; col < extent; col++) {
        pixels[row * extent + col] = (row + col) % 2;
      }
    }
    // Create a single 2x2 block
    pixels[0] = 1;
    pixels[1] = 1;
    pixels[extent] = 1;
    pixels[extent + 1] = 1;
    // N2 penalty = 3 for one 2x2 block
    expect(_computePenalty(pixels, extent)).toBe(3);
  });

  it('adds N2 penalty for overlapping 2x2 blocks', () => {
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    for (let row = 0; row < extent; row++) {
      for (let col = 0; col < extent; col++) {
        pixels[row * extent + col] = (row + col) % 2;
      }
    }
    // Create 2x3 block of 1s (two overlapping 2x2 blocks)
    pixels[0] = 1;
    pixels[1] = 1;
    pixels[2] = 1;
    pixels[extent] = 1;
    pixels[extent + 1] = 1;
    pixels[extent + 2] = 1;
    // N2 penalty = 3 * 2 = 6
    expect(_computePenalty(pixels, extent)).toBe(6);
  });

  it('adds N3 penalty for finder-like pattern 10111010000', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    for (let i = 0; i < pattern.length; i++) {
      pixels[i] = pattern[i];
    }
    // Should include N3 penalty of 40
    const penalty = _computePenalty(pixels, extent);
    expect(penalty).toBeGreaterThanOrEqual(40);
  });

  it('adds N3 penalty for finder-like pattern 00001011101', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const pattern = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i < pattern.length; i++) {
      pixels[i] = pattern[i];
    }
    // Should include N3 penalty of at least 40 (pattern matches)
    const penalty = _computePenalty(pixels, extent);
    expect(penalty).toBeGreaterThanOrEqual(40);
  });

  it('adds N3 penalty for vertical finder-like patterns', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    for (let i = 0; i < pattern.length; i++) {
      pixels[i * extent] = pattern[i];
    }
    // Should include N3 penalty of 40 for vertical pattern
    const penalty = _computePenalty(pixels, extent);
    expect(penalty).toBeGreaterThanOrEqual(40);
  });

  it('includes N1/N2 penalties for 50% dark solid blocks', () => {
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    // First half all 1s, second half all 0s - creates large solid blocks
    for (let i = 0; i < pixels.length / 2; i++) {
      pixels[i] = 1;
    }
    // N4 = 0 for 50% ratio, but N1 and N2 will have penalties from solid blocks
    const penalty = _computePenalty(pixels, extent);
    // Should have significant N1/N2 penalties from the consecutive runs
    expect(penalty).toBeGreaterThan(0);
  });

  it('returns N4 penalty of 100 for all dark', () => {
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    pixels.fill(1);
    // All dark: N1 penalties for all rows/columns, N2 for all 2x2, N4 = 100
    const penalty = _computePenalty(pixels, extent);
    expect(penalty).toBeGreaterThanOrEqual(100);
  });

  it('returns N4 penalty of 100 for all light', () => {
    const extent = 10;
    const pixels = new Uint8Array(extent * extent);
    // All light: N1 penalties, N2 penalties, N4 = 100
    const penalty = _computePenalty(pixels, extent);
    expect(penalty).toBeGreaterThanOrEqual(100);
  });
});

describe('_applyBestPattern', () => {
  it('returns a valid mask pattern (0-7)', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);

    const pattern = _applyBestPattern(pixels, reserved, extent);
    expect(pattern).toBeGreaterThanOrEqual(0);
    expect(pattern).toBeLessThanOrEqual(7);
  });

  it('modifies pixels with the chosen pattern', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    const before = new Uint8Array(pixels);

    _applyBestPattern(pixels, reserved, extent);

    expect(pixels).not.toEqual(before);
  });

  it('snapshot: best pattern result', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    const reserved = new Uint8Array(extent * extent);
    _writeFinderPatterns(pixels, reserved, extent);

    const pattern = _applyBestPattern(pixels, reserved, extent);
    expect({ pattern, grid: pixelsToGrid(pixels, extent) }).toMatchSnapshot();
  });
});

describe('_encodeFormatInfo', () => {
  it('encodes EC level L, mask 0 correctly', () => {
    expect(_encodeFormatInfo(1, 0)).toBe(0b111011111000100);
  });

  it('encodes EC level M, mask 0 correctly', () => {
    expect(_encodeFormatInfo(0, 0)).toBe(0b101010000010010);
  });

  it('encodes EC level L, mask 7 correctly', () => {
    expect(_encodeFormatInfo(1, 7)).toBe(26998);
  });

  it('produces 15-bit result for all combinations', () => {
    for (let ec = 0; ec < 4; ec++) {
      for (let mask = 0; mask <= 7; mask++) {
        const result = _encodeFormatInfo(
          ec,
          mask as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
        );
        expect(result).toBeLessThan(1 << 15);
        expect(result).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('snapshot: all format info values', () => {
    const results: Record<string, number> = {};
    const ecNames = ['M', 'L', 'H', 'Q'];
    for (let ec = 0; ec < 4; ec++) {
      for (let mask = 0; mask <= 7; mask++) {
        results[`EC${ecNames[ec]}_mask${mask}`] = _encodeFormatInfo(
          ec,
          mask as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
        );
      }
    }
    expect(results).toMatchSnapshot();
  });
});

describe('_writeFormatInfo', () => {
  it('writes format info to correct positions', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);

    _writeFormatInfo(pixels, extent, 1, 0);

    let nonZero = 0;
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i]) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  });

  it('snapshot: format info L mask 0', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    _writeFormatInfo(pixels, extent, 1, 0);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });

  it('snapshot: format info H mask 5', () => {
    const extent = 21;
    const pixels = new Uint8Array(extent * extent);
    _writeFormatInfo(pixels, extent, 2, 5);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });
});

describe('_encodeVersionInfo', () => {
  it('encodes version 7 correctly', () => {
    expect(_encodeVersionInfo(7)).toBe(0b000111110010010100);
  });

  it('encodes version 8 correctly', () => {
    expect(_encodeVersionInfo(8)).toBe(0b001000010110111100);
  });

  it('encodes version 40 correctly', () => {
    expect(_encodeVersionInfo(40)).toBe(0b101000110001101001);
  });

  it('produces 18-bit result', () => {
    for (let version = 7; version <= 40; version++) {
      const result = _encodeVersionInfo(version);
      expect(result).toBeLessThan(1 << 18);
    }
  });

  it('snapshot: all version info values', () => {
    const results: Record<string, number> = {};
    for (let version = 7; version <= 40; version++) {
      results[`v${version}`] = _encodeVersionInfo(version);
    }
    expect(results).toMatchSnapshot();
  });
});

describe('_writeVersionInfo', () => {
  it('does nothing for versions below 7', () => {
    for (let version = 1; version <= 6; version++) {
      const extent = extentByVersion[version];
      const pixels = new Uint8Array(extent * extent);
      _writeVersionInfo(pixels, extent, version);
      expect(pixels.every(p => p === 0)).toBe(true);
    }
  });

  it('writes version info for version 7+', () => {
    const extent = extentByVersion[7];
    const pixels = new Uint8Array(extent * extent);
    _writeVersionInfo(pixels, extent, 7);

    let nonZero = 0;
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i]) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  });

  it('snapshot: version info for v7', () => {
    const extent = extentByVersion[7];
    const pixels = new Uint8Array(extent * extent);
    _writeVersionInfo(pixels, extent, 7);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });

  it('snapshot: version info for v40', () => {
    const extent = extentByVersion[40];
    const pixels = new Uint8Array(extent * extent);
    _writeVersionInfo(pixels, extent, 40);
    expect(pixelsToGrid(pixels, extent)).toMatchSnapshot();
  });
});
