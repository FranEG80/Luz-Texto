/* eslint-disable @next/next/no-img-element */
"use client";

import { AlertCircle, Check, Clipboard, Download, FileJson, FileVideo, ImagePlus, LoaderCircle, RefreshCcw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from "react";

type Status = "queued" | "processing" | "done" | "error";
type Item = { id: string; file: File; filename: string; thumbnailUrl: string; previewIsImage: boolean; kind: "image" | "video"; status: Status; selected: boolean; caption: string; title: string; keywords: string[]; error?: string };

const MAX_ITEMS = 200;
const EXPORT_BATCH_SIZE = 5;
const EXTENSIONS = /\.(heic|heif|jpe?g|png|webp|mov|mp4)$/i;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,video/quicktime,video/mp4,.heic,.heif,.jpg,.jpeg,.png,.webp,.mov,.mp4";

function isVideo(file: File) { return file.type.startsWith("video/") || /\.(mov|mp4)$/i.test(file.name); }
function isWebp(file: File) { return file.type === "image/webp" || /\.webp$/i.test(file.name); }
function isMov(file: File) { return file.type === "video/quicktime" || /\.mov$/i.test(file.name); }
function formatBytes(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function keywordText(keywords: string[]) { return keywords.join(", "); }
function parseKeywords(value: string) { return [...new Set(value.split(",").map((keyword) => keyword.trim()).filter(Boolean))].slice(0, 10); }
function fileDateTime(file: File) { const date = new Date(file.lastModified); const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`; }

async function thumbnailFor(file: File) {
  try {
    if (isVideo(file)) return URL.createObjectURL(file);
    const image = await createImageBitmap(file);
    const scale = Math.min(480 / image.width, 480 / image.height, 1);
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.75));
    return URL.createObjectURL(blob ?? file);
  } catch { return URL.createObjectURL(file); }
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState("");
  const [processing, setProcessing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [convertToWebp, setConvertToWebp] = useState(false);
  const [renameByDate, setRenameByDate] = useState(false);
  const itemsRef = useRef<Item[]>([]); const aborters = useRef(new Map<string, AbortController>()); const runId = useRef(0); const activeRun = useRef(false); const addingRef = useRef(false); const exportInFlight = useRef(false); const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.thumbnailUrl)), []);
  const completed = items.filter((item) => item.status === "done").length;
  const selectedItems = items.filter((item) => item.selected);
  const selectedCompleted = selectedItems.filter((item) => item.status === "done").length;
  const selectionComplete = selectedItems.length > 0 && selectedCompleted === selectedItems.length;
  const canDownload = selectionComplete && !processing && !adding && !exporting;
  const canConvert = selectedItems.some((item) => (item.kind === "image" && !isWebp(item.file)) || isMov(item.file));
  const commitItems = (updater: (current: Item[]) => Item[]) => { const next = updater(itemsRef.current); itemsRef.current = next; setItems(next); };
  const update = (id: string, changes: Partial<Item>) => commitItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));

  const add = async (list: FileList | File[]) => {
    if (addingRef.current || exportInFlight.current) return setNotice("Espera a que termine la operación en curso.");
    const files = Array.from(list); const capacity = MAX_ITEMS - itemsRef.current.length;
    const accepted = files.filter((file) => (EXTENSIONS.test(file.name) || file.type.startsWith("image/") || file.type.startsWith("video/")) && file.size <= (isVideo(file) ? 500 : 50) * 1024 * 1024).slice(0, Math.max(0, capacity));
    if (accepted.length !== files.length) setNotice("Solo se admiten HEIC, JPEG, PNG, WebP, MOV y MP4; máximo 50 MB por foto y 500 MB por vídeo.");
    if (!accepted.length) return;
    addingRef.current = true; setAdding(true);
    try {
      for (const file of accepted) {
        const thumbnailUrl = await thumbnailFor(file);
        commitItems((current) => [...current, { id: crypto.randomUUID(), file, filename: file.name, thumbnailUrl, previewIsImage: !isVideo(file), kind: isVideo(file) ? "video" : "image", status: "queued", selected: true, caption: "", title: "", keywords: [] }]);
      }
    } finally { addingRef.current = false; setAdding(false); }
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) void add(event.target.files); event.target.value = ""; };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); void add(event.dataTransfer.files); };

  const generate = async (requested?: string[]) => {
    if (activeRun.current || addingRef.current || exportInFlight.current) return;
    const ids = requested ?? itemsRef.current.filter((item) => item.selected && item.status !== "done").map((item) => item.id);
    if (!ids.length) return setNotice(itemsRef.current.some((item) => item.selected) ? "Todos los archivos seleccionados ya están analizados." : "Selecciona al menos un archivo para analizarlo.");
    const generation = ++runId.current; activeRun.current = true; setProcessing(true); setNotice("");
    try {
      for (const id of ids) {
        if (runId.current !== generation) break;
        const item = itemsRef.current.find((candidate) => candidate.id === id); if (!item) continue;
        const controller = new AbortController(); aborters.current.set(item.id, controller); update(item.id, { status: "processing", error: undefined });
        const traceId = crypto.randomUUID(); const startedAt = performance.now();
        console.info(`[media:${traceId}] ${item.filename} · análisis solicitado`);
        try {
          const form = new FormData(); form.append("media", item.file);
          const response = await fetch("/api/media/analyze", { method: "POST", body: form, headers: { "x-trace-id": traceId }, signal: controller.signal });
          const data = await response.json() as { caption?: string; title?: string; keywords?: string[]; kind?: "image" | "video"; previewDataUrl?: string; traceId?: string; error?: { message?: string; id?: string } };
          console.info(`[media:${data.traceId ?? traceId}] ${item.filename} · respuesta ${response.status} en ${((performance.now() - startedAt) / 1000).toFixed(1)} s`);
          if (!response.ok || !data.caption || !data.title || !data.keywords) throw new Error(`${data.error?.message ?? "No se ha recibido un resultado válido."}${data.error?.id ? ` Referencia: ${data.error.id}` : ""}`);
          if (data.previewDataUrl) { const old = item.thumbnailUrl; const response = await fetch(data.previewDataUrl); const blob = await response.blob(); const thumbnailUrl = URL.createObjectURL(blob); URL.revokeObjectURL(old); update(item.id, { thumbnailUrl, previewIsImage: true }); }
          if (runId.current === generation) update(item.id, { status: "done", caption: data.caption, title: data.title, keywords: data.keywords, kind: data.kind ?? item.kind });
        } catch (cause) { const cancelled = cause instanceof DOMException && cause.name === "AbortError"; if (cancelled) console.info(`[media:${traceId}] ${item.filename} · análisis cancelado`); else console.error(`[media:${traceId}] ${item.filename} · análisis fallido`, cause); if (runId.current === generation) update(item.id, { status: cancelled ? "queued" : "error", error: cause instanceof Error ? cause.message : "Error inesperado." }); }
        finally { if (aborters.current.get(item.id) === controller) aborters.current.delete(item.id); }
      }
    } finally { if (runId.current === generation) { activeRun.current = false; setProcessing(false); } }
  };
  const pause = () => { runId.current += 1; activeRun.current = false; aborters.current.forEach((controller) => controller.abort()); aborters.current.clear(); setProcessing(false); commitItems((current) => current.map((item) => item.status === "processing" ? { ...item, status: "queued" } : item)); };
  const reset = () => { pause(); itemsRef.current.forEach((item) => URL.revokeObjectURL(item.thumbnailUrl)); commitItems(() => []); setNotice(""); };
  const remove = (id: string) => { const item = itemsRef.current.find((candidate) => candidate.id === id); if (item) URL.revokeObjectURL(item.thumbnailUrl); aborters.current.get(id)?.abort(); aborters.current.delete(id); commitItems((current) => current.filter((item) => item.id !== id)); };
  const downloadJson = () => {
    const exportedAt = new Date();
    const currentItems = itemsRef.current;
    const payload = {
      version: 1,
      exportedAt: exportedAt.toISOString(),
      settings: { convertToWebp, renameByDate },
      summary: {
        total: currentItems.length,
        completed: currentItems.filter((item) => item.status === "done").length,
        selected: currentItems.filter((item) => item.selected).length,
      },
      items: currentItems.map((item) => ({
        id: item.id,
        filename: item.filename,
        kind: item.kind,
        mimeType: item.file.type,
        size: item.file.size,
        lastModified: item.file.lastModified,
        lastModifiedIso: new Date(item.file.lastModified).toISOString(),
        selected: item.selected,
        status: item.status,
        title: item.title,
        caption: item.caption,
        keywords: item.keywords,
        error: item.error ?? null,
      })),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `luz-y-texto-metadatos-${exportedAt.toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice(`JSON guardado con ${payload.summary.completed} de ${payload.summary.total} archivos completados.`);
  };
  const download = async () => {
    if (!canDownload || exportInFlight.current) return;
    exportInFlight.current = true; setExporting(true); setNotice("Creando ZIP y escribiendo metadatos…");
    let exportId: string | undefined;
    try {
      const manifest = selectedItems.map(({ id, file, filename, caption, title, keywords }) => ({ id, filename, caption, title, keywords, fallbackDateTime: fileDateTime(file) }));
      const started = await fetch("/api/media/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manifest, convertToWebp, renameByDate }) });
      const startData = await started.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
      if (!started.ok || !startData.id) throw new Error(startData.error?.message ?? "No se ha podido iniciar la exportación.");
      exportId = startData.id;
      let prepared = 0;
      for (let offset = 0; offset < selectedItems.length; offset += EXPORT_BATCH_SIZE) {
        const batch = selectedItems.slice(offset, offset + EXPORT_BATCH_SIZE);
        await Promise.all(batch.map(async (item, batchIndex) => {
          const index = offset + batchIndex;
          const form = new FormData(); form.append("media", item.file); form.append("index", String(index));
          const uploaded = await fetch(`/api/media/export/${exportId}`, { method: "POST", body: form });
          if (!uploaded.ok) {
            const data = await uploaded.json().catch(() => ({})) as { error?: { message?: string } };
            throw new Error(data.error?.message ?? `No se ha podido preparar ${item.filename}.`);
          }
          prepared += 1;
          setNotice(`Preparados ${prepared} de ${selectedItems.length} · lotes de ${EXPORT_BATCH_SIZE}`);
        }));
      }
      setNotice("Comprimiendo los archivos preparados…");
      const response = await fetch(`/api/media/export/${exportId}/complete`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? "No se ha podido crear el ZIP.");
      }
      const link = document.createElement("a"); link.href = `/api/media/export/${exportId}/download`; link.download = `luz-y-texto-${new Date().toISOString().slice(0, 10)}.zip`; link.click(); setNotice("ZIP listo; descarga iniciada.");
    } catch (cause) {
      if (exportId) void fetch(`/api/media/export/${exportId}`, { method: "DELETE" }).catch(() => undefined);
      setNotice(cause instanceof Error ? cause.message : "No se ha podido crear el ZIP.");
    }
    finally { exportInFlight.current = false; setExporting(false); }
  };

  return <main className="min-h-screen bg-[#f5f0e8] text-[#24231e]"><div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12"><header className="flex items-center justify-between border-b border-[#24231e]/15 pb-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-[#b85c3e] text-white"><Sparkles size={18} /></span><div><p className="font-serif text-2xl leading-none">Luz &amp; Texto</p><p className="mt-1 text-[10px] font-bold uppercase tracking-[.18em] text-[#6f7551]">Media caption atelier</p></div></div>{items.length > 0 && <span className="rounded-full bg-[#edf0e3] px-3 py-1 text-xs font-semibold">{items.length} archivos</span>}</header>
    <section className="grid gap-8 py-12 lg:grid-cols-[1.1fr_.9fr] lg:items-end"><div><p className="mb-4 text-xs font-bold uppercase tracking-[.2em] text-[#b85c3e]">De medio a metadatos</p><h1 className="max-w-3xl font-serif text-5xl leading-[.92] tracking-[-.05em] sm:text-6xl">Textos y etiquetas que viajan con tu archivo.</h1></div><p className="max-w-lg text-base leading-7 text-[#57534a]">Extrae ubicación y POIs, genera título, caption y keywords, y descarga los originales etiquetados en un ZIP.</p></section>
    <section className="grid gap-4 lg:grid-cols-[1.45fr_.55fr]"><div onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className="relative min-h-64 rounded-[2rem] border border-dashed border-[#b85c3e]/50 bg-[#fffaf1] p-8"><ImagePlus size={24} /><h2 className="mt-8 font-serif text-3xl">Suelta tus fotos y vídeos</h2><p className="mt-2 text-sm leading-6 text-[#625e55]">HEIC, JPEG, PNG, WebP, MOV o MP4 · hasta 50 MB por foto y 500 MB por vídeo</p><button disabled={exporting} onClick={() => input.current?.click()} className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#b85c3e] px-5 py-3 text-sm font-bold text-white disabled:opacity-45"><Upload size={16} /> Elegir archivos</button><input ref={input} onChange={onChange} className="hidden" type="file" accept={ACCEPT} multiple /></div>
      <aside className="rounded-[2rem] border border-[#24231e]/12 bg-[#eef0e7] p-7"><h2 className="font-serif text-2xl">Salida</h2><p className="mt-2 text-sm leading-6 text-[#656a55]">Los originales conservan sus metadatos. La copia enviada al modelo siempre es WebP reducido.</p><div className="mt-6 space-y-3"><label className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition ${convertToWebp ? "border-[#b85c3e]/45 bg-[#fffaf1] shadow-sm" : "border-[#24231e]/10 bg-white/45 hover:bg-white/70"} ${!canConvert ? "cursor-not-allowed opacity-45" : ""}`}><input type="checkbox" checked={convertToWebp} disabled={!canConvert} onChange={(event) => setConvertToWebp(event.target.checked)} className="peer sr-only" /><span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#d9dfc8] text-[#6f7551] transition peer-checked:bg-[#b85c3e] peer-checked:text-white"><Check size={17} /></span><span><span className="block text-sm font-bold">Optimizar archivos</span><span className="mt-0.5 block text-xs leading-5 text-[#656a55]">Convierte fotos a WebP y MOV a MP4.</span></span></label><label className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition ${renameByDate ? "border-[#b85c3e]/45 bg-[#fffaf1] shadow-sm" : "border-[#24231e]/10 bg-white/45 hover:bg-white/70"}`}><input type="checkbox" checked={renameByDate} onChange={(event) => setRenameByDate(event.target.checked)} className="peer sr-only" /><span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#d9dfc8] text-[#6f7551] transition peer-checked:bg-[#b85c3e] peer-checked:text-white"><Check size={17} /></span><span><span className="block text-sm font-bold">Renombrar por fecha y hora</span><span className="mt-0.5 block text-xs leading-5 text-[#656a55]">Ejemplo: IMG_20260711_115336.</span></span></label></div></aside></section>
    {notice && <div className="mt-5 flex gap-3 rounded-2xl bg-[#fff5ee] px-4 py-3 text-sm text-[#8e442e]"><AlertCircle size={17} className="shrink-0" />{notice}</div>}
    {items.length > 0 && <section className="py-10"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#6f7551]">Colección</p><h2 className="mt-1 font-serif text-3xl">{selectedCompleted} de {selectedItems.length} seleccionados listos</h2><p className="mt-1 text-xs text-[#827c70]">{completed} de {items.length} archivos tienen datos</p></div><div className="flex items-center rounded-2xl border border-[#24231e]/10 bg-[#fffdf8] p-1.5 text-sm font-bold shadow-sm"><button disabled={processing || adding} onClick={() => commitItems((current) => current.map((item) => ({ ...item, selected: true })))} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[#6f7551] transition hover:bg-[#edf0e3] disabled:opacity-40"><Check size={15} /> Todo</button><button disabled={processing || adding} onClick={() => commitItems((current) => current.map((item) => ({ ...item, selected: false })))} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[#6f7551] transition hover:bg-[#f4eee4] disabled:opacity-40"><X size={15} /> Ninguno</button><span className="mx-1 h-6 w-px bg-[#24231e]/10" /><button disabled={adding} onClick={reset} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[#9b533c] transition hover:bg-[#fff1ea] disabled:opacity-40"><Trash2 size={15} /> Reiniciar</button></div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className={`overflow-hidden rounded-[1.45rem] border bg-[#fffdf8] transition ${item.selected ? "border-[#b85c3e]/55 ring-2 ring-[#b85c3e]/10" : "border-[#24231e]/10 opacity-65"}`}><div className="relative aspect-[4/3] bg-[#ded7c9]">{item.previewIsImage ? <img src={item.thumbnailUrl} alt={item.caption || item.filename} className="size-full object-cover" /> : <video src={item.thumbnailUrl} className="size-full object-cover" muted /> }<label className={`absolute left-3 top-3 flex cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-bold shadow-sm backdrop-blur transition ${item.selected ? "border-white/30 bg-[#b85c3e] text-white" : "border-[#24231e]/10 bg-white/90 text-[#57534a]"} ${processing || adding ? "cursor-not-allowed opacity-55" : ""}`}><input type="checkbox" checked={item.selected} disabled={processing || adding} onChange={(event) => update(item.id, { selected: event.target.checked })} aria-label={`Incluir ${item.filename}`} className="peer sr-only" /><span className={`grid size-4 place-items-center rounded-full border ${item.selected ? "border-white/70 bg-white/15" : "border-[#827c70]/45 bg-[#faf7f0]"}`}>{item.selected && <Check size={11} strokeWidth={3} />}</span>{item.selected ? "Incluido" : "No incluir"}</label><button aria-label={`Eliminar ${item.filename}`} onClick={() => remove(item.id)} className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/45 text-white"><X size={15} /></button><span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white">{item.status === "processing" && <LoaderCircle size={12} className="mr-1 inline animate-spin" />}{item.status === "done" && <Check size={12} className="mr-1 inline" />}{item.kind === "video" && <FileVideo size={12} className="mr-1 inline" />}{item.status === "queued" ? "En cola" : item.status === "processing" ? "Analizando" : item.status === "done" ? "Listo" : "Reintentar"}</span></div><div className="space-y-3 p-4"><div className="flex justify-between gap-2"><p className="truncate text-xs font-bold text-[#655f55]">{item.filename}</p><span className="shrink-0 text-[11px] text-[#999185]">{formatBytes(item.file.size)}</span></div>{item.status === "error" ? <div className="rounded-xl bg-[#fff1ea] p-3 text-sm text-[#994931]">{item.error}<button disabled={processing || adding} onClick={() => void generate([item.id])} className="mt-2 flex items-center gap-1 font-bold underline disabled:opacity-40"><RefreshCcw size={13} /> Reintentar</button></div> : <><input value={item.title} onChange={(event) => update(item.id, { title: event.target.value, status: event.target.value && item.caption ? "done" : "queued" })} placeholder="Título" className="w-full rounded-xl border border-[#24231e]/10 bg-[#faf7f0] px-3 py-2 text-sm font-semibold" /><textarea value={item.caption} onChange={(event) => update(item.id, { caption: event.target.value, status: event.target.value && item.title ? "done" : "queued" })} placeholder="El caption aparecerá aquí" className="min-h-22 w-full rounded-xl border border-[#24231e]/10 bg-[#faf7f0] p-3 text-sm" /><input value={keywordText(item.keywords)} onChange={(event) => update(item.id, { keywords: parseKeywords(event.target.value) })} placeholder="Keywords separadas por comas" className="w-full rounded-xl border border-[#24231e]/10 bg-[#faf7f0] px-3 py-2 text-xs" /><div className="flex justify-between"><button disabled={processing || adding} onClick={() => void generate([item.id])} className="flex items-center gap-1 text-xs font-bold text-[#b85c3e] disabled:opacity-40"><RefreshCcw size={13} /> Regenerar</button><button disabled={!item.caption} onClick={() => void navigator.clipboard.writeText(item.caption)} className="flex items-center gap-1 text-xs font-bold text-[#6f7551] disabled:opacity-40"><Clipboard size={13} /> Copiar</button></div></>}</div></article>)}</div></section>}
  </div>{items.length > 0 && <div className="sticky bottom-0 border-t border-[#24231e]/10 bg-[#fffaf1]/95 px-5 py-4 backdrop-blur"><div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3"><p className="text-sm text-[#655f55]">{exporting ? "Creando ZIP…" : adding ? "Preparando archivos…" : processing ? `${selectedCompleted} de ${selectedItems.length} seleccionados completados` : `${selectedItems.length} seleccionados para analizar y descargar`}</p><div className="flex flex-wrap justify-end gap-2">{processing && <button onClick={pause} className="rounded-full border px-4 py-2.5 text-sm font-bold">Pausar</button>}<button disabled={processing || adding || exporting || selectedItems.length === 0 || selectionComplete} onClick={() => void generate()} className="rounded-full bg-[#24231e] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-45">{processing ? <LoaderCircle size={15} className="mr-2 inline animate-spin" /> : <Sparkles size={15} className="mr-2 inline" />}{processing ? "Generando…" : selectionComplete ? "Selección completa" : selectedCompleted ? "Completar selección" : "Generar selección"}</button><button disabled={completed === 0} onClick={downloadJson} className="rounded-full border border-[#6f7551]/30 bg-[#fffdf8] px-5 py-2.5 text-sm font-bold text-[#6f7551] disabled:opacity-40"><FileJson size={15} className="mr-2 inline" />Descargar JSON</button><button disabled={!canDownload} onClick={() => void download()} className="rounded-full bg-[#b85c3e] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">{exporting ? <LoaderCircle size={15} className="mr-2 inline animate-spin" /> : <Download size={15} className="mr-2 inline" />}{exporting ? "Creando ZIP…" : `Descargar ${selectedItems.length} en ZIP`}</button></div></div></div>}</main>;
}
