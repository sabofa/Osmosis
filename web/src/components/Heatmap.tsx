import './Heatmap.css'

const heatColors = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)']

// GitHub-style contribution grid: small square cells, tight gaps, columns = weeks
// (oldest first), rows = days within a week. Width fills the container; height
// follows from aspect-ratio so cells stay square instead of stretching into bars
// when the panel is taller than the weeks:days ratio calls for. Cells fade in
// with a light stagger on mount instead of popping in all at once.
export default function Heatmap({ levels, weeks, days }: { levels: number[]; weeks: number; days: number }) {
  return (
    <div
      className="heatmap"
      style={{
        gridTemplateColumns: `repeat(${weeks}, 1fr)`,
        gridTemplateRows: `repeat(${days}, 1fr)`,
        aspectRatio: `${weeks} / ${days}`,
      }}
    >
      {levels.map((level, i) => (
        <div
          key={i}
          className="heatmap-cell"
          style={{
            background: heatColors[level],
            animationDelay: `${Math.floor(i / days) * 8}ms`,
          }}
        />
      ))}
    </div>
  )
}
