import { Type, type Static } from 'typebox';

export const ClaimCandidateSchema = Type.Object({
  statement: Type.String(),
  evidenceChunkIds: Type.Array(Type.String()),
});

export const RelationCandidateSchema = Type.Object({
  targetName: Type.String(),
  relation: Type.Union([
    Type.Literal('prerequisite'),
    Type.Literal('part_of'),
    Type.Literal('related'),
    Type.Literal('contrast'),
    Type.Literal('extension'),
  ]),
});

export const KnowledgeCandidateSchema = Type.Object({
  canonicalName: Type.String(),
  aliases: Type.Array(Type.String()),
  definition: Type.Optional(Type.String()),
  claims: Type.Array(ClaimCandidateSchema),
  relations: Type.Array(RelationCandidateSchema),
});

export const KnowledgeCandidatesResponseSchema = Type.Object({
  candidates: Type.Array(KnowledgeCandidateSchema),
});

export type ClaimCandidate = Static<typeof ClaimCandidateSchema>;
export type RelationCandidate = Static<typeof RelationCandidateSchema>;
export type KnowledgeCandidate = Static<typeof KnowledgeCandidateSchema>;
export type KnowledgeCandidatesResponse = Static<typeof KnowledgeCandidatesResponseSchema>;
