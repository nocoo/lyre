import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: Date.now(),
    version: process.env.npm_package_version ?? "1.1.0",
  });
}
