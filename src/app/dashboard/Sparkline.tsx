// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

export function Sparkline({
  data,
  color = '#7dd3a1',
  height = 22,
  width = 100,
  fill = true,
}: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  fill?: boolean;
}) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = Math.max(1, max - min);
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 2) - 1] as const);
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = d + ` L${width} ${height} L0 ${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fill && <path d={area} fill={color} opacity="0.15" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
