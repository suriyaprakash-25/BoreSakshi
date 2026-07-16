// ProbabilityRing.jsx — circular gauge, colour-coded by band. Used for the
// farmer success gauge (default labels) and the operator trust score (label /
// suffix overrides).
export default function ProbabilityRing({ value = 0, size = 132, label, suffix = "%" }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * c;

  const color = pct >= 60 ? "var(--mint)" : pct >= 40 ? "var(--amber)" : "var(--red)";
  const bandLabel = label ?? (pct >= 60 ? "Good odds" : pct >= 40 ? "Moderate" : "Risky");

  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="ring">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--track)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray .7s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="ring-center">
        <div className="ring-value" style={{ color }}>
          {pct}
          {suffix ? <span className="ring-pct">{suffix}</span> : null}
        </div>
        <div className="ring-label">{bandLabel}</div>
      </div>
    </div>
  );
}
