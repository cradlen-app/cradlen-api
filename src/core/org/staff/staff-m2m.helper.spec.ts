import { diffIds } from './staff-m2m.helper';

describe('diffIds', () => {
  it('returns empty add/remove when sets are equal', () => {
    expect(diffIds(['a', 'b'], ['b', 'a'])).toEqual({
      toAdd: [],
      toRemove: [],
    });
  });

  it('detects additions only', () => {
    expect(diffIds(['a'], ['a', 'b', 'c'])).toEqual({
      toAdd: ['b', 'c'],
      toRemove: [],
    });
  });

  it('detects removals only', () => {
    expect(diffIds(['a', 'b', 'c'], ['b'])).toEqual({
      toAdd: [],
      toRemove: ['a', 'c'],
    });
  });

  it('detects both additions and removals (symmetric diff)', () => {
    expect(diffIds(['a', 'b'], ['b', 'c'])).toEqual({
      toAdd: ['c'],
      toRemove: ['a'],
    });
  });

  it('handles empty current', () => {
    expect(diffIds([], ['x', 'y'])).toEqual({
      toAdd: ['x', 'y'],
      toRemove: [],
    });
  });

  it('handles empty next (full clear)', () => {
    expect(diffIds(['x', 'y'], [])).toEqual({
      toAdd: [],
      toRemove: ['x', 'y'],
    });
  });
});
