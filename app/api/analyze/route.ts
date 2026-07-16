import { NextResponse } from "next/server";
import { demoAnalysis } from "@/lib/demo-data";

export async function POST() {
  // This endpoint is intentionally deterministic until the GitHub App and OpenAI client are configured.
  return NextResponse.json({ analysis: demoAnalysis, mode: "demo" });
}
