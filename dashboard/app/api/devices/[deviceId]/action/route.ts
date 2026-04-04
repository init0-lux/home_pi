import { NextResponse } from "next/server";

import type { ActionRequest } from "@/lib/contracts";
import { ContractError, setDeviceAction } from "@/lib/server/hub-store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const { deviceId } = await params;
  const payload = (await request.json()) as ActionRequest;

  try {
    if (payload.state !== "ON" && payload.state !== "OFF") {
      return NextResponse.json(
        {
          error: "INVALID_STATE",
          message: "State must be ON or OFF",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(setDeviceAction(deviceId, payload.state));
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
