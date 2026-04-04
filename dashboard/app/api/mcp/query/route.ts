import { NextResponse } from "next/server";

import { queryAssistant } from "@/lib/server/hub-store";

export async function POST(request: Request) {
  const payload = (await request.json()) as { query?: string };

  if (!payload.query?.trim()) {
    return NextResponse.json(
      {
        error: "INVALID_QUERY",
        message: "Query is required",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(queryAssistant(payload.query));
}
