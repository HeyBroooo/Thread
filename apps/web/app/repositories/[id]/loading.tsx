export default function RepositoryLoading() {
  return (
    <main className="section" aria-label="Loading repository page">
      <div className="skeleton" style={{ height: 30, width: 220, marginBottom: 14 }} />
      <div className="skeleton" style={{ height: 16, width: '56%', marginBottom: 28 }} />
      <div className="stat-grid">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div className="skeleton" key={item} style={{ height: 105 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 260, marginTop: 24 }} />
    </main>
  );
}
