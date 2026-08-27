import { LearningRoom } from './LearningRoom.tsx';

export function DiagnosticPage({
  sessionId,
  onNavigate,
  onFlash,
}: {
  sessionId: string;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
}) {
  return <LearningRoom sessionId={sessionId} onNavigate={onNavigate} onFlash={onFlash} />;
}
