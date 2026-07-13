import { z } from "zod";
import type { CaptionProvider, GenerateCaptionInput, GeneratedMetadata } from "./types";

export const GeneratedMetadataSchema = z.object({
  caption: z.string().trim().min(1).max(320),
  title: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
});

export abstract class BaseCaptionProvider implements CaptionProvider {
  abstract generateCaption(input: GenerateCaptionInput): Promise<GeneratedMetadata | undefined>;

  protected metadata(value: unknown): GeneratedMetadata | undefined {
    const parsed = GeneratedMetadataSchema.safeParse(value);
    if (!parsed.success) return undefined;
    return {
      ...parsed.data,
      keywords: [...new Set(parsed.data.keywords.map((keyword) => keyword.trim()).filter(Boolean))].slice(0, 10),
    };
  }
}
