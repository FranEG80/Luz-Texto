import type { CaptionProvider, GenerateCaptionInput } from "./types";
import { ProviderConfigurationError } from "./types";
import { BaseCaptionProvider } from "./base";

class LMStudioCaptionProvider extends BaseCaptionProvider {
  constructor(private readonly endpoint: string, private readonly model: string, private readonly apiKey?: string) { super(); }

  async generateCaption({ prompt, imageDataUrls, signal, traceId }: GenerateCaptionInput) {
      const trace = (stage: string, startedAt: number) => console.info(`[lmstudio:${traceId ?? "request"}] ${stage} · ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
      const headers = {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      };
      const analysisStartedAt = Date.now();
      trace(`análisis iniciado · ${imageDataUrls.length} imagen(es)`, analysisStartedAt);
      const analysisResponse = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          max_output_tokens: Number(process.env.LM_STUDIO_MAX_OUTPUT_TOKENS ?? 420),
          temperature: 0.2,
          reasoning: "on",
          store: false,
          input: [
            {
              type: "text",
              content: `${prompt}\n\nAnaliza cuidadosamente la imagen y el contexto para identificar el lugar, la obra, las inscripciones y el altar. Expón tus hallazgos; todavía no redactes el caption final.`,
            },
            ...imageDataUrls.map((data_url) => ({ type: "image", data_url })),
          ],
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      });
      trace(`análisis respondido (${analysisResponse.status})`, analysisStartedAt);

      if (!analysisResponse.ok) {
        throw new Error(
          `LM Studio ha respondido ${analysisResponse.status}: ${await analysisResponse.text()}`,
        );
      }

      const analysisBody = (await analysisResponse.json()) as {
        output?: Array<{ type?: string; content?: unknown }>;
      };
      const analysis = analysisBody.output
        ?.map((item) => (typeof item.content === "string" ? item.content : ""))
        .filter(Boolean)
        .join("\n");

      const finalStartedAt = Date.now();
      trace("JSON final iniciado", finalStartedAt);
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          max_output_tokens: Number(process.env.LM_STUDIO_FINAL_OUTPUT_TOKENS ?? 180),
          temperature: 0.1,
          reasoning: "off",
          store: false,
          input: [
            {
              type: "text",
              content: `${prompt}\n\nHallazgos de análisis: ${analysis || "No disponibles."}\n\nResponde exactamente con un único objeto JSON válido, sin Markdown ni texto adicional: {"caption":"pie de foto de 15 a 35 palabras","title":"título breve","keywords":["etiqueta"]}.`,
            },
            ...imageDataUrls.map((data_url) => ({ type: "image", data_url })),
          ],
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      });
      trace(`JSON final respondido (${response.status})`, finalStartedAt);

      if (!response.ok) {
        throw new Error(`LM Studio ha respondido ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as {
        output?: Array<{ type?: string; content?: unknown }>;
      };
      const content = body.output?.find((item) => item.type === "message")?.content;
      if (typeof content !== "string") return undefined;

      // Algunos VLM devuelven el JSON envuelto —e incluso duplicado— en bloques Markdown.
      const json = content.match(/\{[\s\S]*?\}/)?.[0];
      if (!json) return undefined;
      return this.metadata(JSON.parse(json));
  }
}

export function createLMStudioProvider(): CaptionProvider {
  const model = process.env.LM_STUDIO_MODEL;
  if (!model) throw new ProviderConfigurationError("Falta LM_STUDIO_MODEL en el entorno del servidor.");
  const configuredUrl = process.env.LM_STUDIO_BASE_URL || "http://127.0.0.1:1234/v1";
  return new LMStudioCaptionProvider(new URL("/api/v1/chat", configuredUrl).toString(), model, process.env.LM_STUDIO_API_KEY);
}
