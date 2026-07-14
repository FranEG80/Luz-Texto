import type { CaptionProvider, GenerateCaptionInput } from "./types";
import { ProviderConfigurationError } from "./types";
import { BaseCaptionProvider } from "./base";

const metadataSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    caption: { type: "string", description: "Pie de foto en español natural, de 15 a 35 palabras." },
    title: { type: "string", description: "Título breve en español." },
    keywords: {
      type: "array",
      description: "Entre una y diez etiquetas descriptivas en español.",
      items: { type: "string" },
      minItems: 1,
      maxItems: 10,
    },
  },
  required: ["caption", "title", "keywords"],
} as const;

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: unknown; refusal?: string } }>;
  error?: { message?: string };
};

class QwenCaptionProvider extends BaseCaptionProvider {
  constructor(private readonly apiKey: string, private readonly model: string) { super(); }

  async generateCaption({ prompt, imageDataUrls, signal, traceId }: GenerateCaptionInput) {
    const startedAt = Date.now();
    console.info(`[qwen:${traceId ?? "request"}] petición iniciada · ${imageDataUrls.length} imagen(es)`);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 256,
        temperature: 0.2,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `${prompt}\n\nDevuelve únicamente los datos solicitados mediante el esquema JSON.` },
            ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "image_metadata", strict: true, schema: metadataSchema },
        },
        provider: { require_parameters: true },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });

    const body = (await response.json()) as OpenRouterResponse;
    if (!response.ok) {
      throw new Error(`OpenRouter ha respondido ${response.status}: ${body.error?.message ?? "error desconocido"}`);
    }

    const message = body.choices?.[0]?.message;
    if (message?.refusal) throw new Error(`Qwen rechazó la solicitud: ${message.refusal}`);
    if (typeof message?.content !== "string") throw new Error("Qwen no devolvió contenido de texto.");

    try {
      const metadata = this.metadata(JSON.parse(message.content));
      if (metadata) {
        console.info(`[qwen:${traceId ?? "request"}] respuesta recibida · ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
        return metadata;
      }
    } catch {
      // La validación uniforme se realiza debajo para informar un único error útil.
    }
    throw new Error("Qwen no devolvió metadatos válidos conforme al esquema solicitado.");
  }
}

export function createQwenProvider(): CaptionProvider {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new ProviderConfigurationError("Falta OPENROUTER_API_KEY en el entorno del servidor.");
  return new QwenCaptionProvider(apiKey, process.env.OPENROUTER_MODEL ?? "qwen/qwen3.7-plus");
}
