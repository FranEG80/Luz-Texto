import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExportItem } from "../lib";

export type ExportSession = {
  manifest: ExportItem[];
  convertToWebp: boolean;
  renameByDate: boolean;
  createdAt: string;
};

const ROOT = path.join(tmpdir(), "luz-texto-export-sessions");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSION_AGE = 24 * 60 * 60 * 1000;

async function removeStaleExportSessions() {
  await mkdir(ROOT, { recursive: true });
  const entries = await readdir(ROOT, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isDirectory() && ID.test(entry.name)).map(async (entry) => {
    const directory = path.join(ROOT, entry.name);
    const details = await stat(directory);
    if (Date.now() - details.mtimeMs > MAX_SESSION_AGE) await rm(directory, { recursive: true, force: true });
  }));
}

export function exportSessionDirectory(id: string) {
  if (!ID.test(id)) throw new Error("Identificador de exportación no válido.");
  return path.join(ROOT, id);
}

export async function createExportSession(input: Pick<ExportSession, "manifest" | "convertToWebp" | "renameByDate">) {
  await removeStaleExportSessions();
  const id = randomUUID();
  const directory = exportSessionDirectory(id);
  await mkdir(directory, { recursive: true });
  await saveExportSession(id, { ...input, createdAt: new Date().toISOString() });
  return id;
}

export async function loadExportSession(id: string) {
  const source = await readFile(path.join(exportSessionDirectory(id), "session.json"), "utf8");
  return JSON.parse(source) as ExportSession;
}

export async function saveExportSession(id: string, session: ExportSession) {
  const directory = exportSessionDirectory(id);
  const temporary = path.join(directory, "session.json.tmp");
  await writeFile(temporary, JSON.stringify(session));
  await rename(temporary, path.join(directory, "session.json"));
}

function exportResultPath(id: string, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= 200) throw new Error("Índice de exportación no válido.");
  return path.join(exportSessionDirectory(id), `result-${index}.json`);
}

export async function loadExportResult(id: string, index: number) {
  try {
    return JSON.parse(await readFile(exportResultPath(id, index), "utf8")) as { outputName: string };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

export async function saveExportResult(id: string, index: number, outputName: string) {
  await writeFile(exportResultPath(id, index), JSON.stringify({ outputName }));
}

export async function loadExportResults(id: string, total: number) {
  return Promise.all(Array.from({ length: total }, (_, index) => loadExportResult(id, index)));
}

export async function removeExportSession(id: string) {
  await rm(exportSessionDirectory(id), { recursive: true, force: true });
}
