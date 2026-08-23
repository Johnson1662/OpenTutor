import { Type, type Static } from 'typebox';

export const ArtifactSectionSchema = Type.Object({
  text: Type.String(),
  claimIds: Type.Array(Type.String()),
});

export const KnowledgeArtifactSchema = Type.Object({
  nodeId: Type.String(),
  title: Type.String(),
  definition: ArtifactSectionSchema,
  intuition: ArtifactSectionSchema,
  mechanism: ArtifactSectionSchema,
  prerequisites: Type.Array(Type.String()),
  formula: Type.Optional(ArtifactSectionSchema),
  examples: Type.Array(ArtifactSectionSchema),
  misconceptions: Type.Array(ArtifactSectionSchema),
  related: Type.Array(Type.String()),
});

export type ArtifactSection = Static<typeof ArtifactSectionSchema>;
export type KnowledgeArtifact = Static<typeof KnowledgeArtifactSchema>;
