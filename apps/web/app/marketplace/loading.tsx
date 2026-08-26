export default function MarketplaceLoading() {
  return (
    <main
      className="marketplace-app"
      aria-busy="true"
      aria-label="Loading agents"
    >
      <section className="marketplace-hero page-shell loading-shell">
        <div className="loading-line short" />
        <div className="loading-line title" />
        <div className="loading-line" />
      </section>
      <section className="page-shell loading-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="loading-card" key={index} />
        ))}
      </section>
    </main>
  );
}
