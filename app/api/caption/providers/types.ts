export type CaptionProviderName = "openai" | "lmstudio";

export type GenerateCaptionInput = {
  prompt: string;
  imageDataUrls: string[];
  signal?: AbortSignal;
  traceId?: string;
};

export type GeneratedMetadata = {
  caption: string;
  title: string;
  keywords: string[];
};

export type CaptionProvider = {
  generateCaption(input: GenerateCaptionInput): Promise<GeneratedMetadata | undefined>;
};

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}
