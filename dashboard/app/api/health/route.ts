import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: Math.floor(Date.now() / 1000),
  });
}
