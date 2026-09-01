import type { Metadata } from "next";

import { internalServiceVerifications } from "../../../lib/commerce";
import { requestInternalServiceVerificationAction } from "../../operator-actions";
import { RequestServiceVerificationButton } from "../../_components/request-service-verification-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Service verification operations" };

const dateTime = (value: string | null) =>
  value === null
    ? "Never"
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));

export default async function ServiceVerificationOperationsPage() {
  let rows: Awaited<ReturnType<typeof internalServiceVerifications>> = [];
  let error: string | null = null;
  try {
    rows = await internalServiceVerifications();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Operations unavailable";
  }
  return (
    <main className="page-shell operations-page">
      <span className="overline">Relic operations</span>
      <h1>Service verification</h1>
      <p className="hero-copy">
        Review seller requests and the actual result from Relic’s safe service
        checks. The worker performs checks automatically; this page is for
        visibility and exceptions.
      </p>
      {error !== null ? (
        <div className="state-panel">
          <h2>Verification operations unavailable</h2>
          <p>{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="state-panel">
          <h2>No services need review.</h2>
          <p>New seller verification requests will appear here.</p>
        </div>
      ) : (
        <section className="profile-section seller-agent-list-section">
          <div className="section-heading">
            <div>
              <span className="overline">Service checks</span>
              <h2>Verification queue</h2>
            </div>
            <p>{rows.length} services shown</p>
          </div>
          <div className="seller-agent-list">
            {rows.map((service) => (
              <article className="seller-agent-list-item" key={service.serviceId}>
                <div className="seller-agent-list-main">
                  <div>
                    <h3>{service.agentName}</h3>
                    <span className="overline">Agent #{service.externalAgentId}</span>
                    <p>{service.endpoint ?? "No public service endpoint supplied."}</p>
                    <dl className="seller-agent-facts">
                      <div>
                        <dt>Request</dt>
                        <dd>{dateTime(service.verificationRequestedAt)}</dd>
                      </div>
                      <div>
                        <dt>Last check</dt>
                        <dd>{dateTime(service.latestObservedAt)}</dd>
                      </div>
                      <div>
                        <dt>Result</dt>
                        <dd>{service.latestResult ?? "Not checked"}</dd>
                      </div>
                      <div>
                        <dt>Availability</dt>
                        <dd>{service.availability}</dd>
                      </div>
                    </dl>
                    {service.latestErrorMessage === null ? null : (
                      <p className="operations-note">
                        Latest error: {service.latestErrorMessage}
                      </p>
                    )}
                    <RequestServiceVerificationButton
                      action={requestInternalServiceVerificationAction.bind(
                        null,
                        service.serviceId,
                      )}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
