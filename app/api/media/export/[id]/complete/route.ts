import { createPreparedMediaZip, uniqueExportOutputNames } from "../../../lib";
import { exportSessionDirectory, loadExportResults, loadExportSession } from "../../session";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await loadExportSession(id);
    const results = await loadExportResults(id, session.manifest.length);
    if (results.some((result) => !result)) return Response.json({ error: { message: "La exportación todavía no está completa." } }, { status: 409 });
    const completed = results.map((result) => result!);
    const outputNames = uniqueExportOutputNames(completed.map((result) => result.outputName));
    await createPreparedMediaZip(exportSessionDirectory(id), outputNames, {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { convertToWebp: session.convertToWebp, renameByDate: session.renameByDate },
      items: session.manifest.map((item, index) => ({
        id: item.id,
        originalFilename: item.filename,
        outputFilename: outputNames[index],
        capturedAt: completed[index].capturedAt ?? null,
        capturedAtSource: completed[index].capturedAtSource,
        originalModifiedAt: completed[index].originalModifiedAt ?? null,
        title: item.title,
        caption: item.caption,
        keywords: item.keywords,
      })),
    });
    return Response.json({ ready: true });
  } catch (cause) {
    console.error(`[media-export:${id}:complete]`, cause);
    return Response.json({ error: { message: "No se ha podido crear el ZIP." } }, { status: 502 });
  }
}
