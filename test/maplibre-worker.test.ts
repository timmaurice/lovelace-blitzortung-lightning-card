import { it, describe, vi, expect } from 'vitest';
import { installMapLibreWorker } from '../src/maplibre-worker';

describe('installMapLibreWorker', () => {
  // Several map cards on one dashboard are the normal case, and every one of them runs this on
  // its way to `new maplibregl.Map(...)`. MapLibre must still be handed one URL, once: a fresh
  // blob per card would leak an object URL per card, and a per-card URL revoked when that card
  // is torn down would break the next map to start.
  it('creates one blob worker URL and hands it to MapLibre only once', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    const firstCard = { setWorkerUrl: vi.fn() };
    const secondCard = { setWorkerUrl: vi.fn() };

    installMapLibreWorker(firstCard);
    installMapLibreWorker(firstCard);
    installMapLibreWorker(secondCard);

    expect(firstCard.setWorkerUrl).toHaveBeenCalledTimes(1);
    expect(secondCard.setWorkerUrl).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(firstCard.setWorkerUrl.mock.calls[0][0]).to.match(/^blob:/);

    // MapLibre starts the worker as a module worker, and a module worker's script has to be
    // served as JavaScript; a blob with the wrong type is rejected outright.
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).to.equal('text/javascript');
    expect(blob.size).to.be.greaterThan(0);

    // The URL has to outlive every card on the page, so nothing may revoke it.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});
