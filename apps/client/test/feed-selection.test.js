import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FEED_INDEX = resolve(process.cwd(), 'apps/client/src/feed/index.js');
const CLIENT_SRC = resolve(process.cwd(), 'apps/client/src');

function sourceFiles(directory){
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

describe('FI-13 — client source selection stays inside the feed seam', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); });
  afterEach(() => { vi.useRealTimers(); });

  it('keeps SimulatedIndexSource as the normal/default client source', async () => {
    const { createIndexSource } = await import('../src/feed/index.js');
    const { SimulatedIndexSource } = await import('../src/feed/SimulatedIndexSource.js');
    expect(createIndexSource('')).toBeInstanceOf(SimulatedIndexSource);
  });

  it('selects the recorded fixture only through ?feed=replay', async () => {
    const { ReplayIndexSource } = await import('@crush/feed');
    const { createIndexSource } = await import('../src/feed/index.js');
    expect(createIndexSource('?feed=replay')).toBeInstanceOf(ReplayIndexSource);
  });

  it('does not leak a concrete replay source name outside feed modules', () => {
    for (const file of sourceFiles(CLIENT_SRC)){
      if (file.startsWith(resolve(process.cwd(), 'apps/client/src/feed'))) continue;
      expect(readFileSync(file, 'utf8')).not.toContain('ReplayIndexSource');
    }
    expect(readFileSync(FEED_INDEX, 'utf8')).toContain('ReplayIndexSource');
  });
});
