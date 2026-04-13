type StatCardProps = {
  label: string;
  value: number;
  tone: string;
};

export function StatCard({ label, value, tone }: StatCardProps) {
  return (
    <article className="stat-card" style={{ ['--tone' as string]: tone }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}