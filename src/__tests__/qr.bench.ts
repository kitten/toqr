import { bench, describe } from 'vitest';
import { toQR } from './fixtures/lib';
import qrTerminal from 'qrcode-terminal';

// Promisify qrcode-terminal's generate function
const generateQRTerminal = (input: string): Promise<string> => {
  return new Promise(resolve => {
    qrTerminal.generate(input, { small: true }, resolve);
  });
};

const SHORT_TEXT = 'Hello';
const URL = 'https://example.com/path?query=value';
const LONG_TEXT =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

describe('QR Code Generation - Short Text', () => {
  bench('toqr', () => {
    toQR(SHORT_TEXT);
  });

  bench('qrcode-terminal', async () => {
    await generateQRTerminal(SHORT_TEXT);
  });
});

describe('QR Code Generation - URL', () => {
  bench('toqr', () => {
    toQR(URL);
  });

  bench('qrcode-terminal', async () => {
    await generateQRTerminal(URL);
  });
});

describe('QR Code Generation - Long Text', () => {
  bench('toqr', () => {
    toQR(LONG_TEXT);
  });

  bench('qrcode-terminal', async () => {
    await generateQRTerminal(LONG_TEXT);
  });
});
