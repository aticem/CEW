import { describe, it, expect } from 'vitest';
import { getOrderedOverlayIds } from './dcctOverlayOrder.js';

describe('getOrderedOverlayIds', () => {
  it('returns keys as-is when bringToFrontId is missing', () => {
    expect(getOrderedOverlayIds({ a: 1, b: 2 }, null)).toEqual(['a', 'b']);
  });

  it('moves bringToFrontId to the end when present', () => {
    expect(getOrderedOverlayIds({ a: 1, b: 2, c: 3 }, 'b')).toEqual(['a', 'c', 'b']);
  });

  it('does nothing when bringToFrontId not present', () => {
    expect(getOrderedOverlayIds({ a: 1, b: 2 }, 'x')).toEqual(['a', 'b']);
  });
});
