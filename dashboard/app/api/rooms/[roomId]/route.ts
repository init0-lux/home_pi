import { NextResponse } from "next/server";

import { ContractError, getRoom } from "@/lib/server/hub-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;

  try {
    return NextResponse.json(getRoom(roomId));
  } catch (error) {
    if (error instanceof ContractError) {
      return NextResponse.json(error.payload, { status: error.status });
    }

    return NextResponse.json(
      {
        error: "UNKNOWN_ERROR",
        message: "Unexpected error",
      },
      { status: 500 },
    );
  }
}
