import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const body = await request.json();
    console.log("[webhook]", body.event, body.data);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }
}
