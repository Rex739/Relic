import { CommandBar } from "@/components/relic/CommandBar";
import { ReviewTabs } from "@/components/relic/ReviewTabs";
import { WorkspaceFrame } from "@/components/relic/WorkspaceFrame";

export default function MeridianBillingReviewPage() {
  return (
    <WorkspaceFrame>
      <CommandBar breadcrumb="Reviews / Meridian Grid" />
      <ReviewTabs />
    </WorkspaceFrame>
  );
}
