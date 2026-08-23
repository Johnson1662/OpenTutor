import type { LearningPathNode } from '@opentutor/protocol';

export function LearningPathPanel({ path }: { path: LearningPathNode[] }) {
  return (
    <aside className="path-panel">
      <div className="section-label">Learning path</div>
      <div className="path-list">
        {path.map((node) => (
          <div className={`path-node ${node.status} ${node.type}`} key={node.id}>
            <span className="path-marker">
              {node.status === 'completed' ? '✓' : node.status === 'current' ? '●' : node.type === 'detour' ? '◇' : '○'}
            </span>
            <div>
              <div className="path-title">{node.title}</div>
              {node.note && <div className="path-note">{node.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
