import { redirect } from "next/navigation";

/** Legacy spelling retained for bookmarked seller links. */
export default function LegacyMyListingsPage() {
  redirect("/account/my-listings");
}
