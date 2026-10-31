import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchLumaFeed, syncLumaSources, type SyncRepository } from "@/lib/luma-sync";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "sync_not_configured" }, { status: 503 });
  if (!isAuthorizedCronRequest(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!url || !key || !ownerEmail) return Response.json({ error: "sync_not_configured" }, { status: 503 });

  const supabase = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (userError) return Response.json({ error: "sync_unavailable" }, { status: 503 });
  const owner = userData.users.find((user) => user.email?.toLowerCase() === ownerEmail);
  if (!owner) return Response.json({ error: "sync_not_configured" }, { status: 503 });

  const repository: SyncRepository = {
    async listEnabledLumaSources() {
      const { data, error } = await supabase.from("sources").select("id,owner_id,name,feed_url")
        .eq("owner_id", owner.id).eq("source_type", "luma_ical").eq("enabled", true);
      if (error) throw new Error("Unable to read configured sources");
      return (data ?? []).filter((source) => typeof source.feed_url === "string" && source.feed_url.length > 0)
        .map((source) => ({ id: source.id, ownerId: source.owner_id, name: source.name, feedUrl: source.feed_url! }));
    },
    async insertEvents(events) {
      const { data, error } = await supabase.from("events").upsert(events, {
        onConflict: "owner_id,source_id,external_id", ignoreDuplicates: true,
      }).select("id");
      if (error) throw new Error("Unable to save imported events");
      return data?.length ?? 0;
    },
  };

  try {
    const result = await syncLumaSources(repository, fetchLumaFeed);
    return Response.json(result, { status: 200 });
  } catch {
    return Response.json({ error: "sync_unavailable" }, { status: 503 });
  }
}
