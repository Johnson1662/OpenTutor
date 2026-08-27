import { CourseSpacePage } from './CourseSpacePage.tsx';

export function MaterialsPage({
  courseId,
  onNavigate,
  onFlash,
}: {
  courseId?: string;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
}) {
  if (!courseId) {
    return <div className="page-shell empty-state-card">请选择一门课程查看学习材料。</div>;
  }
  return <CourseSpacePage courseId={courseId} initialTab="materials" onNavigate={onNavigate} onFlash={onFlash} />;
}
