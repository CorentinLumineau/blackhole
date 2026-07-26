import { expect } from 'bun:test';
import { findMissingGateMarkers } from './check-common.ts';

// Shared fixed/stale marker-contract assertions for verify.* gate-marker tests (issue #382).

export const expectMarkersPresent = (content: string, markers: string[]): void => {
  expect(findMissingGateMarkers(content, markers)).toEqual([]);
};

export const expectMarkersMissing = (content: string, markers: string[]): void => {
  expect(findMissingGateMarkers(content, markers)).toEqual(markers);
};

export const expectMarkerContract = (fixed: string, stale: string, markers: string[]): void => {
  expectMarkersPresent(fixed, markers);
  expectMarkersMissing(stale, markers);
};

export const expectMarkersSubstantive = (markers: string[]): void => {
  expect(markers.length).toBeGreaterThan(0);
  for (const marker of markers) {
    expect(marker.trim()).not.toBe('');
    expect(marker.trim().length).toBeGreaterThan(3);
  }
  expect(findMissingGateMarkers('unrelated prose with none of the gate wording', markers)).toEqual(
    markers,
  );
};
