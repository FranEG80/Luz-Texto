import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { logCaptionError } from "./logger";
import { getCaptionProvider, ProviderConfigurationError } from "./providers";

export const runtime = "nodejs";

const MAX_FILE_BYTES = Number(process.env.MAX_IMAGE_MB ?? 5) * 1024 * 1024;
const VISION_MAX_DIMENSION = Math.max(
  512,
  Math.min(3072, Number(process.env.VISION_MAX_DIMENSION ?? 2048)),
);
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_NEARBY_POIS = 3;
type MetadataRecord = Record<string, unknown>;

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable = false,
  id?: string,
) {
  return Response.json({ error: { code, message, retryable, id } }, { status });
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nearbyPois(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((poi): poi is MetadataRecord => Boolean(poi) && typeof poi === "object" && !Array.isArray(poi))
    .map((poi) => ({
      name: text(poi.name),
      description: text(poi.description),
      distanceMeters: number(poi.distanceMeters),
    }))
    .filter((poi): poi is { name: string; description: string | undefined; distanceMeters: number } => Boolean(poi.name) && poi.distanceMeters !== undefined && poi.distanceMeters >= 0)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_NEARBY_POIS);
}

function metadataContext(record?: MetadataRecord) {
  if (!record) return undefined;

  const location =
    record.location && typeof record.location === "object"
      ? (record.location as MetadataRecord)
      : undefined;
  const coordinates =
    record.coordinates && typeof record.coordinates === "object"
      ? (record.coordinates as MetadataRecord)
      : undefined;
  const keywords = Array.isArray(record.keywords)
    ? record.keywords.filter((keyword): keyword is string => typeof keyword === "string")
    : [];
  const pois = nearbyPois(record.nearbyPois);

  const context = {
    title: text(record.title),
    keywords: keywords.slice(0, 12),
    takenAt: text(record.takenAt),
    coordinates: coordinates
      ? {
          latitude: number(coordinates.latitude),
          longitude: number(coordinates.longitude),
        }
      : undefined,
    location: location
      ? {
          displayName: text(location.displayName),
          city: text(location.city),
          country: text(location.country),
          region: text(location.region),
          district: text(location.district),
          road: text(location.road),
        }
      : undefined,
    nearbyPois: pois.length > 0 ? pois : undefined,
  };

  return JSON.stringify(context);
}

function promptFor(context?: string) {
  return [
    "Escribe un único pie de foto en español natural, descriptivo y accesible.",
    "Debe tener entre 15 y 35 palabras y poder usarse también como texto alternativo.",
    "Examina con atención las inscripciones, escudos, iconografía, arquitectura y obras visibles.",
    "Prioriza identificar de forma concreta el monumento, iglesia, capilla, altar u obra cuando la imagen y el contexto lo permitan.",
    "Si hay una inscripción legible, úsala para contextualizar el lugar u obra. No inventes nombres, relaciones, intenciones ni hechos.",
    "Si recibes contexto de metadatos, incluida la ubicación, coordenadas o POIs próximos, úsalo solo para confirmar una identificación visual o resolver una ambigüedad; nunca dejes que sustituya a la imagen ni menciones datos técnicos.",
    "Los POIs son pistas ordenadas por proximidad, no una afirmación de que aparezcan en la foto. Menciona uno únicamente si lo respalda lo que se ve en la imagen.",
    context ? `Contexto secundario: ${context}` : "No hay metadatos adicionales.",
  ].join("\n");
}

function optimizeForVision(input: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const magick = spawn(
      process.env.MAGICK_PATH ?? "magick",
      [
        "-",
        "-auto-orient",
        "-strip",
        "-resize",
        `${VISION_MAX_DIMENSION}x${VISION_MAX_DIMENSION}>`,
        "-quality",
        "75",
        "webp:-",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let settled = false;

    const finish = (callback: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        callback();
      }
    };

    const timeout = setTimeout(() => {
      magick.kill("SIGKILL");
      finish(() => reject(new Error("La optimización de la imagen ha tardado demasiado.")));
    }, 20_000);

    magick.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    magick.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    magick.on("error", () =>
      finish(() => reject(new Error("ImageMagick no está disponible en este sistema."))),
    );
    magick.on("close", (code) => {
      const image = Buffer.concat(output);
      if (code !== 0 || image.length === 0) {
        const detail = Buffer.concat(errors).toString().trim();
        finish(() => reject(new Error(detail || "No se ha podido preparar la imagen.")));
        return;
      }
      finish(() => resolve(image));
    });

    magick.stdin.end(input);
  });
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "La petición debe contener un formulario válido.");
  }

  const image = formData.get("image");
  if (!(image instanceof File)) {
    return errorResponse(400, "INVALID_IMAGE", "Selecciona una imagen válida.");
  }
  if (!ACCEPTED_TYPES.has(image.type)) {
    return errorResponse(400, "INVALID_IMAGE", "Solo se admiten archivos JPEG, PNG o WebP.");
  }
  if (image.size > MAX_FILE_BYTES) {
    return errorResponse(413, "FILE_TOO_LARGE", "La imagen supera el tamaño permitido.");
  }

  let metadata: MetadataRecord | undefined;
  const rawMetadata = formData.get("metadata");
  if (typeof rawMetadata === "string" && rawMetadata) {
    try {
      const parsed: unknown = JSON.parse(rawMetadata);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      metadata = parsed as MetadataRecord;
    } catch {
      return errorResponse(400, "INVALID_METADATA", "Los metadatos de esta imagen no son válidos.");
    }
  }

  try {
    const source = Buffer.from(await image.arrayBuffer());
    const optimized = await optimizeForVision(source);
    const { name, provider } = getCaptionProvider();
    const generated = await provider.generateCaption({
      prompt: promptFor(metadataContext(metadata)),
      imageDataUrls: [`data:image/webp;base64,${optimized.toString("base64")}`],
    });
    const caption = generated?.caption.replace(/\s+/g, " ").trim();
    if (!caption) {
      const id = randomUUID();
      await logCaptionError({
        id,
        code: "CAPTION_EMPTY",
        message: "El proveedor no devolvió un caption válido.",
        provider: name,
        model: name === "lmstudio" ? process.env.LM_STUDIO_MODEL : process.env.OPENAI_MODEL,
        filename: image.name,
      });
      return errorResponse(502, "CAPTION_FAILED", "No se ha recibido un caption válido.", true, id);
    }
    return Response.json({ caption });
  } catch (error) {
    const id = randomUUID();
    if (error instanceof ProviderConfigurationError) {
      await logCaptionError({
        id,
        code: "PROVIDER_NOT_CONFIGURED",
        message: error.message,
        provider: process.env.CAPTION_PROVIDER ?? "openai",
        filename: image.name,
      });
      return errorResponse(503, "PROVIDER_NOT_CONFIGURED", error.message, false, id);
    }
    const apiError = error instanceof OpenAI.APIError ? error : undefined;
    const retryable = !apiError || apiError.status === 408 || apiError.status === 429 || apiError.status >= 500;
    const detail = error instanceof Error ? error.message : "Error desconocido";
    await logCaptionError({
      id,
      code: apiError?.code ?? "CAPTION_FAILED",
      message: detail,
      provider: process.env.CAPTION_PROVIDER ?? "openai",
      model:
        process.env.CAPTION_PROVIDER === "lmstudio"
          ? process.env.LM_STUDIO_MODEL
          : process.env.OPENAI_MODEL,
      filename: image.name,
    });
    return errorResponse(
      apiError?.status && apiError.status < 500 ? apiError.status : 502,
      "CAPTION_FAILED",
      "No se ha podido generar el caption. Puedes reintentarlo.",
      retryable,
      id,
    );
  }
}
