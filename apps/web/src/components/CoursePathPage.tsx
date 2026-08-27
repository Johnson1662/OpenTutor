import { CourseSpacePage } from './CourseSpacePage.tsx';

export function CoursePathPage({
  courseId,
  onNavigate,
  onFlash,
}: {
  courseId: string;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
}) {
  return <CourseSpacePage courseId={courseId} initialTab="route" onNavigate={onNavigate} onFlash={onFlash} />;
}
