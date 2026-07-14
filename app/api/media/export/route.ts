import { z } from "zod";
import { createExportSession } from "./session";

export const runtime = "nodejs";

const ItemSchema = z.object({ id: z.string(), filename: z.string(), caption: z.string().trim().min(1).max(320), title: z.string().trim().min(1).max(120), keywords: z.array(z.string().trim().min(1).max(80)).max(10), fallbackDateTime: z.string().regex(/^\d{8}_\d{6}$/).optional(), originalModifiedAt: z.string().datetime().optional() });
const RequestSchema = z.object({ manifest: z.array(ItemSchema).min(1).max(300), convertToWebp: z.boolean(), renameByDate: z.boolean() });

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: { message: "La exportación no es válida." } }, { status: 400 });
  try {
    const id = await createExportSession(parsed.data);
    return Response.json({ id });
  } catch (cause) {
    console.error("[media-export:create]", cause);
    return Response.json({ error: { message: "No se ha podido iniciar la exportación." } }, { status: 502 });
  }
}
