import { NextResponse } from "next/server";
import { extractEventPageDetails, EventUrlExtractionError } from "@/lib/event-url-extraction";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
  }

  let body: unknown;
  try {
    if (!request.body) return NextResponse.json({ error: "La solicitud no contiene JSON válido." }, { status: 400 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 8_192) {
        await reader.cancel();
        return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  }
  catch { return NextResponse.json({ error: "La solicitud no contiene JSON válido." }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof (body as { url?: unknown }).url !== "string") {
    return NextResponse.json({ error: "Introduce la URL del evento." }, { status: 400 });
  }

  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim());
  if (!supabaseConfigured && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "La autenticación del espacio no está configurada." }, { status: 503 });
  }
  if (supabaseConfigured) {
    try {
      const supabase = await createClient();
      const { data: { user }, error } = await supabase.auth.getUser();
      const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
      if (error || !user || !ownerEmail || user.email?.toLowerCase() !== ownerEmail) {
        return NextResponse.json({ error: "No tienes acceso a este espacio." }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "No se pudo verificar la sesión del espacio." }, { status: 401 });
    }
  }

  try {
    return NextResponse.json(await extractEventPageDetails((body as { url: string }).url));
  } catch (error) {
    if (error instanceof EventUrlExtractionError) return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json({ error: "No se pudieron extraer los datos del evento." }, { status: 502 });
  }
}
