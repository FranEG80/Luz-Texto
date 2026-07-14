import { randomUUID } from "node:crypto";
import { getCaptionProvider, ProviderConfigurationError } from "../../caption/providers";
import { logCaptionError } from "../../caption/logger";
import { analyzeMedia, IMAGE_TYPES, VIDEO_TYPES } from "../lib";

export const runtime = "nodejs";

function error(status: number, message: string, id?: string) {
  return Response.json({ error: { message, id } }, { status });
}

export async function POST(request: Request) {
  const id = request.headers.get("x-trace-id")?.slice(0, 100) || randomUUID();
  const startedAt = Date.now();
  const trace = (stage: string, detail?: string) => console.info(`[media-analyze:${id}] +${((Date.now() - startedAt) / 1000).toFixed(1)}s ${stage}${detail ? ` · ${detail}` : ""}`);
  trace("petición recibida");
  const form = await request.formData().catch(() => undefined);
  const media = form?.get("media");
  if (!(media instanceof File)) { trace("petición rechazada", "archivo no válido"); return error(400, "Selecciona un archivo válido.", id); }
  trace("archivo recibido", `${media.name}; ${media.size} bytes`);
  const supported = IMAGE_TYPES.has(media.type) || VIDEO_TYPES.has(media.type) || /\.(heic|heif|jpe?g|png|webp|mov|mp4)$/i.test(media.name);
  const maximum = (VIDEO_TYPES.has(media.type) || /\.(mov|mp4)$/i.test(media.name) ? 500 : 75) * 1024 * 1024;
  if (!supported) { trace("petición rechazada", "formato no admitido"); return error(400, "Formato no admitido.", id); }
  if (media.size > maximum) { trace("petición rechazada", "archivo demasiado grande"); return error(413, "El archivo supera el tamaño permitido.", id); }
  try {
    const { provider } = getCaptionProvider();
    const result = await analyzeMedia(media, (prompt, imageDataUrls) => provider.generateCaption({ prompt, imageDataUrls, signal: request.signal, traceId: id }));
    trace("petición completada");
    return Response.json({ ...result, traceId: id });
  } catch (cause) {
    if (request.signal.aborted) { trace("petición cancelada"); return error(499, "Análisis cancelado.", id); }
    const message = cause instanceof ProviderConfigurationError ? cause.message : "No se ha podido analizar este archivo.";
    trace("petición fallida", cause instanceof Error ? cause.message : message);
    await logCaptionError({ id, code: "MEDIA_ANALYZE_FAILED", message: cause instanceof Error ? cause.message : message, provider: process.env.CAPTION_PROVIDER ?? "openai", filename: media.name });
    return error(cause instanceof ProviderConfigurationError ? 503 : 502, message, id);
  }
}
