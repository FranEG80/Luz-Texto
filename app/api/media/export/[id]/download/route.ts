import { streamPreparedMediaZip } from "../../../lib";
import { exportSessionDirectory, loadExportSession } from "../../session";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await loadExportSession(id);
    const body = streamPreparedMediaZip(exportSessionDirectory(id));
    return new Response(body, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename=\"media-tag-optimizer-${new Date().toISOString().slice(0, 10)}.zip\"`, "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (cause) {
    console.error(`[media-export:${id}:download]`, cause);
    return Response.json({ error: { message: "El ZIP ya no está disponible." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
