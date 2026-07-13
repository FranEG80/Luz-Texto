import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { exiftool } from "exiftool-vendored";
import * as archiverModule from "archiver";
import type { GeneratedMetadata } from "../caption/providers/types";

export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
export const VIDEO_TYPES = new Set(["video/quicktime", "video/mp4"]);
const MAX_VISION_DIMENSION = Math.max(512, Math.min(3072, Number(process.env.VISION_MAX_DIMENSION ?? 2048)));
const geocodeCache = new Map<string, Record<string, string | null>>();
const poiCache = new Map<string, Array<{ name: string; description?: string; distanceMeters: number }>>();
let nominatimQueue = Promise.resolve();

export type MediaKind = "image" | "video";
export type ExtractedMetadata = { title: string; keywords: string[]; context?: string };
export type AnalysisResult = GeneratedMetadata & { kind: MediaKind; previewDataUrl?: string };
export type ExportItem = { id: string; filename: string; caption: string; title: string; keywords: string[]; fallbackDateTime?: string };
type Trace = (stage: string, detail?: string) => void;

function traceFor(filename: string): Trace {
  const startedAt = Date.now();
  return (stage, detail) => console.log(`[media:${filename}] +${((Date.now() - startedAt) / 1000).toFixed(1)}s ${stage}${detail ? ` · ${detail}` : ""}`);
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", () => reject(new Error(`${command} no está disponible.`)));
    child.on("close", (code) => {
      const message = Buffer.concat(errors).toString().trim();
      if (code === 0) resolve();
      else reject(new Error(message.slice(-3_000) || `${command} falló.`));
    });
  });
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extension(file: File) {
  const fromName = path.extname(file.name).toLowerCase();
  if (fromName) return fromName;
  return file.type === "image/jpeg" ? ".jpg" : file.type === "video/quicktime" ? ".mov" : ".bin";
}

function isVideo(file: File) {
  return VIDEO_TYPES.has(file.type) || /\.(mov|mp4)$/i.test(file.name);
}

async function tempFile(file: File) {
  const dir = await mkdtemp(path.join(tmpdir(), "luz-texto-"));
  const source = path.join(dir, `source${extension(file)}`);
  await writeFile(source, Buffer.from(await file.arrayBuffer()));
  return { dir, source };
}

function distanceMeters(a: number, b: number, c: number, d: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const x = radians(c - a), y = radians(d - b);
  const q = Math.sin(x / 2) ** 2 + Math.cos(radians(a)) * Math.cos(radians(c)) * Math.sin(y / 2) ** 2;
  return Math.round(2 * 6_371_008.8 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q)));
}

async function locationContext(latitude?: number, longitude?: number, trace?: Trace) {
  if (latitude === undefined || longitude === undefined) { trace?.("GPS", "sin coordenadas"); return undefined; }
  trace?.("GPS", `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  let location = geocodeCache.get(key);
  if (!location) {
    trace?.("Nominatim", "esperando turno");
    const queued = nominatimQueue.then(async () => {
      trace?.("Nominatim", "consulta iniciada");
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("lat", String(latitude)); url.searchParams.set("lon", String(longitude));
      url.searchParams.set("format", "jsonv2"); url.searchParams.set("addressdetails", "1"); url.searchParams.set("accept-language", "es");
      const response = await fetch(url, { headers: { "User-Agent": process.env.NOMINATIM_USER_AGENT || "luz-texto/1.0" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error("No se pudo geocodificar la imagen.");
      const json = await response.json() as { display_name?: string; address?: Record<string, string> };
      const address = json.address ?? {};
      return { displayName: json.display_name ?? null, city: address.city ?? address.town ?? address.village ?? null, country: address.country ?? null, region: address.state ?? null };
    });
    nominatimQueue = queued.then(() => new Promise<void>((resolve) => setTimeout(resolve, 1_100)), () => new Promise<void>((resolve) => setTimeout(resolve, 1_100)));
    try { location = await queued; geocodeCache.set(key, location); trace?.("Nominatim", "ubicación resuelta"); } catch { location = undefined; trace?.("Nominatim", "falló; se continúa sin ubicación"); }
  } else trace?.("Nominatim", "resultado desde caché");
  let pois = poiCache.get(key);
  if (!pois) {
    try {
      trace?.("Wikipedia", "consulta de POIs iniciada");
      const url = new URL("https://es.wikipedia.org/w/api.php");
      url.search = new URLSearchParams({ action: "query", generator: "geosearch", ggscoord: `${latitude}|${longitude}`, ggsradius: "1000", ggslimit: "20", ggsnamespace: "0", prop: "coordinates|description", format: "json", formatversion: "2", origin: "*" }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      const json = await response.json() as { query?: { pages?: Array<{ title?: string; description?: string; coordinates?: Array<{ lat?: number; lon?: number }> }> } };
      const seen = new Set<string>();
      pois = (json.query?.pages ?? []).flatMap((page) => {
        const coordinate = page.coordinates?.[0];
        if (!page.title || coordinate?.lat === undefined || coordinate.lon === undefined) return [];
        const name = page.title.trim(); const id = name.toLocaleLowerCase("es");
        if (seen.has(id)) return []; seen.add(id);
        return [{ name, description: text(page.description) || undefined, distanceMeters: distanceMeters(latitude, longitude, coordinate.lat, coordinate.lon) }];
      }).filter((poi) => poi.distanceMeters <= 1000).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 3);
      poiCache.set(key, pois);
      trace?.("Wikipedia", `${pois.length} POIs cercanos`);
    } catch { pois = []; trace?.("Wikipedia", "falló; se continúa sin POIs"); }
  } else trace?.("Wikipedia", `${pois.length} POIs desde caché`);
  return JSON.stringify({ coordinates: { latitude, longitude }, location, nearbyPois: pois });
}

async function readMetadata(source: string, trace?: Trace): Promise<ExtractedMetadata> {
  trace?.("EXIF", "lectura iniciada");
  const metadata = await exiftool.read(source);
  const latitude = number(metadata.GPSLatitude), longitude = number(metadata.GPSLongitude);
  const keywords = [...new Set([metadata.Keywords, metadata.Subject, metadata.XPKeywords].flatMap((value) => Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,]/) : []).map(text).filter(Boolean))].slice(0, 10);
  trace?.("EXIF", `lectura terminada; ${keywords.length} keywords existentes`);
  return { title: text(metadata.Title) || text(metadata.XPTitle), keywords, context: await locationContext(latitude, longitude, trace) };
}

async function visionImage(source: string, output: string, trace?: Trace, label = "imagen") {
  trace?.("Visión", `${label}: ImageMagick iniciado`);
  await run(process.env.MAGICK_PATH ?? "magick", [source, "-auto-orient", "-strip", "-resize", `${MAX_VISION_DIMENSION}x${MAX_VISION_DIMENSION}>`, "-quality", "82", output]);
  trace?.("Visión", `${label}: WebP listo`);
}

async function videoFrames(source: string, dir: string, trace?: Trace) {
  trace?.("Vídeo", "leyendo duración con ffprobe");
  const duration = await new Promise<number>((resolve) => {
    const child = spawn(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", source]);
    let output = ""; child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", () => resolve(Number(output) || 1)); child.on("error", () => resolve(1));
  });
  trace?.("Vídeo", `duración ${duration.toFixed(1)} s; extrayendo 3 fotogramas`);
  const frames = ["20", "50", "80"].map((position) => path.join(dir, `${position}.webp`));
  for (const [index, fraction] of [0.2, 0.5, 0.8].entries()) {
    const rawFrame = path.join(dir, `${index}.png`);
    trace?.("Vídeo", `fotograma ${index + 1}/3 (${Math.round(fraction * 100)} %) con FFmpeg`);
    await run(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-y", "-ss", String(Math.max(0, duration * fraction)), "-analyzeduration", "100M", "-probesize", "100M",
      "-i", source, "-map", "0:v:0?", "-an", "-sn", "-dn", "-frames:v", "1",
      rawFrame,
    ]);
    await visionImage(rawFrame, frames[index], trace, `fotograma ${index + 1}/3`);
  }
  return frames;
}

function prompt(context?: string, video = false) {
  return [
    "Responde en español con un único JSON válido con caption, title y keywords.",
    "caption: descripción natural y accesible de 15 a 35 palabras. title: 3 a 10 palabras sin punto final. keywords: 5 a 10 etiquetas concretas sin duplicados.",
    "No inventes nombres, lugares, fechas ni hechos. Los metadatos y POIs son pistas: menciona un lugar solo si la imagen lo confirma.",
    video ? "Las imágenes son tres fotogramas del mismo vídeo." : "Analiza la imagen con atención.",
    context ? `Contexto secundario: ${context}` : "No hay metadatos geográficos adicionales.",
  ].join("\n");
}

export async function analyzeMedia(file: File, generate: (prompt: string, imageDataUrls: string[]) => Promise<GeneratedMetadata | undefined>): Promise<AnalysisResult> {
  const trace = traceFor(file.name);
  trace("Análisis", `${file.size} bytes; preparando temporal`);
  const { dir, source } = await tempFile(file);
  try {
    const kind: MediaKind = isVideo(file) ? "video" : "image";
    trace("Análisis", `archivo temporal listo; tipo ${kind}`);
    const metadata = await readMetadata(source, trace);
    const visualFiles = kind === "video" ? await videoFrames(source, dir, trace) : [path.join(dir, "vision.webp")];
    if (kind === "image") await visionImage(source, visualFiles[0], trace);
    const images = await Promise.all(visualFiles.map(async (filename) => `data:image/webp;base64,${(await readFile(filename)).toString("base64")}`));
    trace("LLM", `${images.length} imagen(es) listas; petición iniciada`);
    const generated = await generate(prompt(metadata.context, kind === "video"), images);
    if (!generated) throw new Error("El proveedor no devolvió metadatos válidos.");
    trace("LLM", "respuesta recibida");
    const title = metadata.title || generated.title;
    const keywords = metadata.keywords.length ? metadata.keywords : [...new Set(generated.keywords.map(text).filter(Boolean))].slice(0, 10);
    trace("Análisis", "completado");
    return { ...generated, title, keywords, kind, previewDataUrl: images[0] };
  } finally { await rm(dir, { recursive: true, force: true }); trace("Análisis", "temporales eliminados"); }
}

function metadataTags(item: ExportItem) {
  return {
    ImageDescription: item.caption, Description: item.caption, "Caption-Abstract": item.caption,
    Title: item.title, XPTitle: item.title, ObjectName: item.title,
    Keywords: item.keywords, Subject: item.keywords, XPKeywords: item.keywords.join(";"),
  };
}

async function preservedImageTags(source: string) {
  const metadata = await exiftool.read(source);
  const names = [
    "DateTimeOriginal", "CreateDate", "ModifyDate", "Make", "Model", "LensModel",
    "ISO", "FNumber", "ExposureTime", "FocalLength", "FocalLengthIn35mmFormat",
    "GPSLatitude", "GPSLongitude", "GPSAltitude", "GPSImgDirection", "Rating",
  ] as const;
  return Object.fromEntries(names.flatMap((name) => metadata[name] === undefined ? [] : [[name, metadata[name]]])) as Record<string, unknown>;
}

async function makeImage(source: string, output: string, convertToWebp: boolean, item: ExportItem) {
  if (convertToWebp && path.extname(source).toLowerCase() !== ".webp") {
    await run(process.env.MAGICK_PATH ?? "magick", [source, "-auto-orient", "-quality", "82", output]);
  } else await copyFile(source, output);
  await exiftool.write(output, { ...await preservedImageTags(source), ...metadataTags(item) }, ["-overwrite_original"]);
}

async function makeVideo(source: string, output: string, item: ExportItem, asMp4: boolean) {
  await run(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "0", "-c", "copy", ...(asMp4 ? ["-tag:v", "hvc1", "-movflags", "+faststart+use_metadata_tags"] : []), "-metadata", `title=${item.title}`, "-metadata", `description=${item.caption}`, "-metadata", `comment=${item.caption}`, "-metadata", `keywords=${item.keywords.join(", ")}`, output]);
}

function dateTimeName(value: unknown) {
  if (value && typeof value === "object") {
    const date = value as { year?: unknown; month?: unknown; day?: unknown; hour?: unknown; minute?: unknown; second?: unknown };
    const parts = [date.year, date.month, date.day, date.hour, date.minute, date.second].map(Number);
    if (parts.every(Number.isFinite)) return `${String(parts[0]).padStart(4, "0")}${String(parts[1]).padStart(2, "0")}${String(parts[2]).padStart(2, "0")}_${String(parts[3]).padStart(2, "0")}${String(parts[4]).padStart(2, "0")}${String(parts[5]).padStart(2, "0")}`;
  }
  if (typeof value === "string") {
    const match = value.match(/(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (match) return `${match[1]}${match[2]}${match[3]}_${match[4]}${match[5]}${match[6]}`;
  }
}

async function capturedDateTime(source: string, fallback = "sin_fecha") {
  const metadata = await exiftool.read(source);
  for (const value of [metadata.SubSecDateTimeOriginal, metadata.DateTimeOriginal, metadata.CreationDate, metadata.CreateDate, metadata.MediaCreateDate]) {
    const formatted = dateTimeName(value); if (formatted) return formatted;
  }
  return fallback;
}

function uniqueOutputName(base: string, extension: string, usedNames: Set<string>) {
  let suffix = 1; let candidate = `${base}${extension}`;
  while (usedNames.has(candidate.toLocaleLowerCase())) { suffix += 1; candidate = `${base}_${String(suffix).padStart(2, "0")}${extension}`; }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

export function uniqueExportOutputNames(outputNames: string[]) {
  const usedNames = new Set<string>();
  return outputNames.map((outputName) => uniqueOutputName(path.parse(outputName).name, path.extname(outputName), usedNames));
}

export async function prepareMediaExportFile(dir: string, file: File, item: ExportItem, index: number, convertToWebp: boolean, renameByDate: boolean) {
  const trace = traceFor("ZIP");
  const source = path.join(dir, `source-${index}${extension(file)}`);
  try {
    await writeFile(source, Buffer.from(await file.arrayBuffer()));
    const video = isVideo(file);
    const convertMov = video && convertToWebp && path.extname(file.name).toLowerCase() === ".mov";
    const outputExtension = convertMov ? ".mp4" : convertToWebp && !video && path.extname(file.name).toLowerCase() !== ".webp" ? ".webp" : path.extname(file.name);
    const outputBase = renameByDate ? `IMG_${await capturedDateTime(source, item.fallbackDateTime)}` : path.parse(file.name).name;
    const outputName = `${outputBase}${outputExtension}`;
    const output = path.join(dir, `output-${index}${path.extname(outputName)}`);
    trace("Exportación", `preparando ${file.name} → ${outputName}`);
    if (video) await makeVideo(source, output, item, convertMov); else await makeImage(source, output, convertToWebp, item);
    trace("Exportación", `${file.name}: metadatos escritos`);
    return outputName;
  } finally {
    await rm(source, { force: true });
  }
}

export async function createPreparedMediaZip(dir: string, outputNames: string[]) {
  const trace = traceFor("ZIP");
  trace("Exportación", `${outputNames.length} archivo(s) preparados; creando ZIP`);
  try {
    const archive = new archiverModule.ZipArchive({ zlib: { level: 8 } });
    const zipPath = path.join(dir, "luz-y-texto.zip");
    const destination = createWriteStream(zipPath);
    archive.pipe(destination);
    const completed = new Promise<void>((resolve, reject) => {
      destination.on("close", resolve);
      destination.on("error", reject);
      archive.on("error", reject);
    });
    outputNames.forEach((outputName, index) => archive.file(path.join(dir, `output-${index}${path.extname(outputName)}`), { name: outputName }));
    await archive.finalize();
    await completed;
    trace("Exportación", "ZIP completado");
  } catch (error) {
    trace("Exportación", `falló: ${error instanceof Error ? error.message.slice(-500) : String(error)}`);
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export function streamPreparedMediaZip(dir: string) {
  const stream = createReadStream(path.join(dir, "luz-y-texto.zip"));
  const cleanup = () => { void rm(dir, { recursive: true, force: true }); };
  stream.on("close", cleanup);
  stream.on("error", cleanup);
  return Readable.toWeb(stream) as ReadableStream;
}
