import { IMAGE_TYPES, prepareMediaExportFile, VIDEO_TYPES } from "../../lib";
import { exportSessionDirectory, loadExportResult, loadExportSession, removeExportSession, saveExportResult } from "../session";

export const runtime = "nodejs";

function error(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await request.formData().catch((cause) => { console.error(`[media-export:${id}:upload]`, cause); return undefined; });
  const media = form?.get("media");
  const rawIndex = form?.get("index");
  const index = typeof rawIndex === "string" ? Number(rawIndex) : Number.NaN;
  if (!(media instanceof File) || !Number.isInteger(index)) return error(400, "El archivo de exportación no es válido.");
  const supported = IMAGE_TYPES.has(media.type) || VIDEO_TYPES.has(media.type) || /\.(heic|heif|jpe?g|png|webp|mov|mp4)$/i.test(media.name);
  const maximum = (VIDEO_TYPES.has(media.type) || /\.(mov|mp4)$/i.test(media.name) ? 500 : 75) * 1024 * 1024;
  if (!supported) return error(400, "Formato no admitido.");
  if (media.size > maximum) return error(413, "El archivo supera el tamaño permitido.");
  try {
    const session = await loadExportSession(id);
    const item = session.manifest[index];
    if (!item || index < 0 || media.name !== item.filename) return error(400, "El archivo no coincide con el manifiesto de exportación.");
    if (await loadExportResult(id, index)) return Response.json({ completed: index + 1, total: session.manifest.length });
    const outputName = await prepareMediaExportFile(exportSessionDirectory(id), media, item, index, session.convertToWebp, session.renameByDate);
    await saveExportResult(id, index, outputName);
    return Response.json({ completed: index + 1, total: session.manifest.length });
  } catch (cause) {
    console.error(`[media-export:${id}:item:${index}]`, cause);
    return error(502, `No se ha podido preparar ${media.name}.`);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { await removeExportSession(id); } catch (cause) { console.error(`[media-export:${id}:cancel]`, cause); }
  return new Response(null, { status: 204 });
}
