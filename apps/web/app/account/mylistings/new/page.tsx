import { redirect } from "next/navigation";

/** Legacy spelling retained for bookmarked seller links. */
export default function LegacyRegisterAgentPage() {
  redirect("/account/my-listings/new");
}
