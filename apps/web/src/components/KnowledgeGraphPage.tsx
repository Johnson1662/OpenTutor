import { CourseSpacePage } from './CourseSpacePage.tsx';

export function KnowledgeGraphPage({
  courseId,
  onNavigate,
  onFlash,
}: {
  courseId?: string;
  onNavigate: (route: string) => void;
  onFlash: (message: string) => void;
}) {
  if (!courseId) {
    return <div className="page-shell empty-state-card">请选择一门课程查看知识地图。</div>;
  }
  return <CourseSpacePage courseId={courseId} initialTab="knowledge" onNavigate={onNavigate} onFlash={onFlash} />;
}
