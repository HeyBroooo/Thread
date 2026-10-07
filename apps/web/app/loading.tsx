export default function Loading() {
  return (
    <main className="app" aria-label="Loading dashboard">
      <div className="skeleton" style={{ height: 36, width: 230, marginBottom: 18 }} />
      <div className="skeleton" style={{ height: 180, width: '100%', marginBottom: 28 }} />
      <div className="section-head">
        <div className="skeleton" style={{ height: 24, width: 170 }} />
      </div>
      <div className="repo-grid">
        {[0, 1, 2].map((item) => (
          <div className="card loading-card" key={item}>
            <div className="skeleton" style={{ height: 20, width: '58%', marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 14, width: '82%', marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 14, width: '44%' }} />
          </div>
        ))}
      </div>
    </main>
  );
}
