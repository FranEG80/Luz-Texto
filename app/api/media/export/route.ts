import { z } from "zod";
import { zipMedia } from "../lib";

export const runtime = "nodejs";

const ItemSchema = z.object({ id: z.string(), filename: z.string(), caption: z.string().trim().min(1).max(320), title: z.string().trim().min(1).max(120), keywords: z.array(z.string().trim().min(1).max(80)).max(10), fallbackDateTime: z.string().regex(/^\d{8}_\d{6}$/).optional() });

export async function POST(request: Request) {
  const form = await request.formData().catch(() => undefined);
  if (!form) return Response.json({ error: { message: "La exportación no es válida." } }, { status: 400 });
  const raw = form.get("manifest");
  if (typeof raw !== "string") return Response.json({ error: { message: "Falta el manifiesto de exportación." } }, { status: 400 });
  let manifest: unknown;
  try { manifest = JSON.parse(raw); } catch { return Response.json({ error: { message: "El manifiesto de exportación no es JSON válido." } }, { status: 400 }); }
  const parsed = z.array(ItemSchema).safeParse(manifest);
  const files = form.getAll("media").filter((value): value is File => value instanceof File);
  if (!parsed.success || files.length !== parsed.data.length || files.length === 0) return Response.json({ error: { message: "Los archivos y sus metadatos no coinciden." } }, { status: 400 });
  const convertToWebp = form.get("convertToWebp") === "true";
  const renameByDate = form.get("renameByDate") === "true";
  try {
    const body = await zipMedia(files, parsed.data, convertToWebp, renameByDate);
    return new Response(body, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="luz-y-texto-${new Date().toISOString().slice(0, 10)}.zip"` } });
  } catch (cause) {
    console.error("[media-export]", cause);
    return Response.json({ error: { message: "No se ha podido crear el ZIP." } }, { status: 502 });
  }
}
