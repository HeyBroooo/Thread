import { describe, expect, it } from 'vitest';
import { buildValuesTuples } from '../packages/graph/src/sqlValues.js';

describe('PostgreSQL multi-row placeholders', () => {
  it('numbers every edge value contiguously across row boundaries', () => {
    const tuples = buildValuesTuples(3, 12);

    expect(tuples).toHaveLength(3);
    expect(tuples[0]).toBe('($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)');
    expect(tuples[1]).toBe('($13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)');
    expect(tuples[2]).toBe('($25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)');

    const indexes = tuples.join(',').match(/\$\d+/g)?.map((value) => Number(value.slice(1))) ?? [];
    expect(indexes).toEqual(Array.from({ length: 36 }, (_, index) => index + 1));
  });
});
