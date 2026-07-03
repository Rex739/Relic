import { CommandBar } from "@/components/relic/CommandBar";
import { WorkspaceFrame } from "@/components/relic/WorkspaceFrame";

const settingsSections = [
  {
    title: "Workspace",
    rows: [
      ["System", "Meridian Grid / Billing Core"],
      ["Environment", "Simulation"],
      ["Review mode", "Strict"],
    ],
  },
  {
    title: "Agent workflow",
    rows: [
      ["Review Agent", "Enabled"],
      ["Verification Agent", "Enabled"],
      ["Human release approval", "Required"],
    ],
  },
  {
    title: "Release control",
    rows: [
      ["Blocked reviews", "Require remediation"],
      ["Release readiness", "Separate clean review required"],
      ["Kaspa commitment prototype", "Testnet 12 / compiled locally / not deployed"],
    ],
  },
];

export default function SettingsPage() {
  return (
    <WorkspaceFrame>
      <CommandBar breadcrumb="Settings" />
      <div className="px-5 py-8 lg:px-10">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Workspace settings</h1>
          <p className="mt-3 text-lg text-muted">Configuration for the current Relic simulation workspace.</p>
        </div>

        <div className="mt-10 grid gap-5 xl:grid-cols-3">
          {settingsSections.map((section) => (
            <section key={section.title} className="border border-line bg-raised p-5 md:p-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">{section.title}</h2>
              <dl className="mt-6 space-y-0">
                {section.rows.map(([label, value]) => (
                  <div key={label} className="border-t border-line py-4">
                    <dt className="text-sm text-muted">{label}</dt>
                    <dd className="mt-2 text-sm font-semibold leading-6 text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="mt-6 border border-line bg-canvas px-4 py-3 text-sm text-muted">
          Configuration changes are disabled in this simulation workspace.
        </p>
      </div>
    </WorkspaceFrame>
  );
}
