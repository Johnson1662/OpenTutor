import { normalizeText } from '../source/source-hash.ts';

export type ClaimComparisonRelation =
  | 'EXACT_DUPLICATE'
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'QUALIFIES'
  | 'NEW';

export interface ClaimComparisonResult {
  relation: ClaimComparisonRelation;
  confidence: number;
  existingClaimId?: string;
  explanation?: string;
}

export class ClaimComparator {
  compare(
    newStatement: string,
    existingClaims: Array<{ id: string; statement: string; normalizedStatement: string }>
  ): ClaimComparisonResult {
    const newNorm = normalizeText(newStatement);

    for (const existing of existingClaims) {
      if (existing.normalizedStatement === newNorm) {
        return {
          relation: 'EXACT_DUPLICATE',
          confidence: 1.0,
          existingClaimId: existing.id,
        };
      }

      // Check for direct negation/contradiction heuristics
      const existingNorm = existing.normalizedStatement;
      const hasContradiction =
        (newNorm.includes(' not ') && !existingNorm.includes(' not ') && this.overlap(newNorm.replace(' not ', ' '), existingNorm) >= 0.4) ||
        (existingNorm.includes(' not ') && !newNorm.includes(' not ') && this.overlap(existingNorm.replace(' not ', ' '), newNorm) >= 0.4) ||
        (newNorm.includes('decreases') && existingNorm.includes('improves') && this.overlap(newNorm, existingNorm) >= 0.4) ||
        (newNorm.includes('improves') && existingNorm.includes('decreases') && this.overlap(newNorm, existingNorm) >= 0.4);

      if (hasContradiction) {
        return {
          relation: 'CONTRADICTS',
          confidence: 0.9,
          existingClaimId: existing.id,
          explanation: `Contradicting statements detected between '${newStatement}' and '${existing.statement}'`,
        };
      }

      // Check for qualification / conditional
      if (
        (newNorm.startsWith(existingNorm) && newNorm.length > existingNorm.length) ||
        (newNorm.includes('only when') || newNorm.includes('if and only if') || newNorm.includes('unless'))
      ) {
        if (this.overlap(newNorm, existingNorm) > 0.6) {
          return {
            relation: 'QUALIFIES',
            confidence: 0.85,
            existingClaimId: existing.id,
          };
        }
      }
    }

    return {
      relation: 'NEW',
      confidence: 1.0,
    };
  }

  private overlap(a: string, b: string): number {
    const wordsA = new Set(a.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const wordsB = new Set(b.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }

    return (2 * intersection) / (wordsA.size + wordsB.size);
  }
}
