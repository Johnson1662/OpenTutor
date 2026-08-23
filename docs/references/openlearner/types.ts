export type InteractionType = 
  | 'multiple_choice' 
  | 'segmenter' 
  | 'connector' 
  | 'categorizer' 
  | 'info';

export interface VisualAsset {
  type: 'image' | 'diagram' | 'formula';
  src?: string;
  alt?: string;
  latex?: string;
}

export interface QuizOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface LessonStep {
  id: string;
  type: InteractionType;
  title?: string;
  content: string;
  question?: string;
  hint?: string;
  options?: QuizOption[];
  correctAnswer?: string | string[];
  visualAssets?: VisualAsset[];
}

export interface Level {
  id: string;
  title: string;
  description: string;
  order: number;
  chapterId?: string;
  // AI 返回的是 chapterIndex (数字)
  chapterIndex?: number;
  status: 'locked' | 'available' | 'completed';
  steps: LessonStep[];
  xpReward: number;
}

export interface Chapter {
  id: string;
  title: string;
  description: string;
  order: number;
  levelIds: string[];
}

export interface UserProgress {
  totalXP: number;
  currentStreak: number;
  energy: number;
  maxEnergy: number;
  completedLevels: string[];
  lastStudyDate?: string;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface CourseRequirements {
  courseId: string;
  subject?: string;
  priorKnowledge: string;
  learningGoal: string;
  learningPacing: string;
  materialSourceType?: string;
  createdAt?: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  icon: string;
  thumbnail: string;
  coverImage: string;
  lessons: number;
  exercises: number;
  chapters: Chapter[];
  levels: Level[];
  progress: number;
  createdAt: Date;
  lastAccessedAt?: Date;
  requirements?: CourseRequirements;
}

export interface StreakDay {
  day: string;
  label: string;
  active: boolean;
  isToday?: boolean;
}

export type PageView = 'home' | 'courses' | 'learning' | 'quiz' | 'course-detail';

export interface RecentCourse {
  courseId: string;
  courseTitle: string;
  thumbnail: string;
  progress: number;
  lastAccessedAt: Date;
}

export interface StudyRecord {
  id: string;
  userId: string;
  courseId: string;
  levelId?: string;
  studyDate: string;
  duration: number;
  xpEarned: number;
}

// ============================================
// API Response Types
// ============================================

/**
 * Generic API response wrapper
 * Backend returns {"success": boolean, "data": T, "error"?: string}
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Response from /ai/generate-course
 * Backend returns: {"success": true, "data": {"course": Course}}
 */
export interface GenerateCourseResponseData {
  course: Course;
}

export type GenerateCourseResponse = ApiResponse<GenerateCourseResponseData>;

/**
 * Response from /ai/generate-level
 * Backend returns: {"success": true, "data": {"steps": LessonStep[]}}
 */
export interface GenerateLevelResponseData {
  steps: LessonStep[];
}

export type GenerateLevelResponse = ApiResponse<GenerateLevelResponseData>;

/**
 * Response from /ai/parse-material
 */
export interface ParseMaterialResponse {
  text: string;
  title?: string;
}
