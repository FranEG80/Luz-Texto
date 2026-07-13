import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

type CaptionErrorLog = {
  id: string;
  code: string;
  message: string;
  provider: string;
  model?: string;
  filename?: string;
};

function safeMessage(value: string) {
  return value
    .replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi, "[imagen omitida]")
    .slice(0, 1800);
}

export async function logCaptionError(entry: CaptionErrorLog) {
  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
    message: safeMessage(entry.message),
  };

  console.error("[caption-error]", record);
  if (process.env.CAPTION_ERROR_LOGS === "false") return;

  try {
    const directory = join(process.cwd(), "logs");
    await mkdir(directory, { recursive: true });
    await appendFile(join(directory, "caption-errors.ndjson"), `${JSON.stringify(record)}\n`, "utf8");
  } catch (loggingError) {
    console.error("[caption-error-log-failed]", loggingError);
  }
}
