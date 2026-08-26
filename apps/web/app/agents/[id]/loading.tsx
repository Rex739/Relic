export default function AgentLoading() {
  return (
    <main className="page-shell agent-profile loading-shell" aria-busy="true">
      <div className="loading-line short" />
      <div className="loading-line title" />
      <div className="loading-line" />
      <div className="loading-profile-grid">
        <div className="loading-card tall" />
        <div className="loading-card tall" />
      </div>
    </main>
  );
}
