import { NextResponse } from "next/server";
import { extractEventPageDetails, EventUrlExtractionError } from "@/lib/event-url-extraction";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
  }

  let body: unknown;
  try { body = await request.json(); }
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
