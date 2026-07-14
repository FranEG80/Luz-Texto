import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { CaptionProvider, GenerateCaptionInput } from "./types";
import { ProviderConfigurationError } from "./types";
import { BaseCaptionProvider, GeneratedMetadataSchema } from "./base";

class OpenAICaptionProvider extends BaseCaptionProvider {
  constructor(private readonly client: OpenAI, private readonly model: string) { super(); }

  async generateCaption({ prompt, imageDataUrls, signal, traceId }: GenerateCaptionInput) {
      const startedAt = Date.now();
      console.info(`[openai:${traceId ?? "request"}] petición iniciada · ${imageDataUrls.length} imagen(es)`);
      const response = await this.client.responses.parse({
        model: this.model,
        store: false,
        // GPT-5.6 uses `medium` reasoning by default. This request only needs a
        // short, schema-constrained description, so reserve the token budget for it.
        ...(this.model.startsWith("gpt-5.") ? { reasoning: { effort: "none" as const } } : {}),
        max_output_tokens: 256,
        text: { format: zodTextFormat(GeneratedMetadataSchema, "image_metadata") },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              ...imageDataUrls.map((image_url) => ({ type: "input_image" as const, image_url, detail: "high" as const })),
            ],
          },
        ],
      }, { signal });

      console.info(`[openai:${traceId ?? "request"}] respuesta recibida · ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);

      const metadata = this.metadata(response.output_parsed);
      if (metadata) return metadata;

      const detail = response.incomplete_details?.reason ?? response.error?.message ?? `estado ${response.status}`;
      throw new Error(`OpenAI no devolvió metadatos estructurados (${detail}).`);
  }
}

export function createOpenAIProvider(): CaptionProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ProviderConfigurationError("Falta OPENAI_API_KEY en el entorno del servidor.");
  return new OpenAICaptionProvider(new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000 }), process.env.OPENAI_MODEL ?? "gpt-5.6-luna");
}
