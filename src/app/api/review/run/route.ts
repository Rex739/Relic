import { NextResponse } from "next/server";
import { runMeridianReview } from "@/lib/relic/reviewEngine";

export async function POST() {
  try {
    const result = runMeridianReview();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "review_run_failed",
        message: error instanceof Error ? error.message : "Unexpected review engine failure.",
      },
      { status: 500 },
    );
  }
}
