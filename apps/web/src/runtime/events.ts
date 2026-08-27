export function isNewLearningEvent(lastSeq: number, eventSeq: number): boolean {
  return eventSeq > lastSeq;
}
