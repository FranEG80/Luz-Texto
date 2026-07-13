import { createPreparedMediaZip, uniqueExportOutputNames } from "../../../lib";
import { exportSessionDirectory, loadExportResults, loadExportSession } from "../../session";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await loadExportSession(id);
    const results = await loadExportResults(id, session.manifest.length);
    if (results.some((result) => !result)) return Response.json({ error: { message: "La exportación todavía no está completa." } }, { status: 409 });
    const outputNames = uniqueExportOutputNames(results.map((result) => result?.outputName ?? ""));
    await createPreparedMediaZip(exportSessionDirectory(id), outputNames);
    return Response.json({ ready: true });
  } catch (cause) {
    console.error(`[media-export:${id}:complete]`, cause);
    return Response.json({ error: { message: "No se ha podido crear el ZIP." } }, { status: 502 });
  }
}
