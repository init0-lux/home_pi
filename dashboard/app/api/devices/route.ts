import { NextResponse } from "next/server";

import { listDevices } from "@/lib/server/hub-store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(listDevices());
}
