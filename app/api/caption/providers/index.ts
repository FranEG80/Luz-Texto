import { createLMStudioProvider } from "./lmstudio";
import { createOpenAIProvider } from "./openai";
import { createQwenProvider } from "./qwen";
import { ProviderConfigurationError } from "./types";
import type { CaptionProvider, CaptionProviderName } from "./types";

export { ProviderConfigurationError } from "./types";

export function getCaptionProvider(): {
  name: CaptionProviderName;
  provider: CaptionProvider;
} {
  const name = (process.env.CAPTION_PROVIDER ?? "openai").toLowerCase();

  if (name === "openai") return { name, provider: createOpenAIProvider() };
  if (name === "lmstudio") return { name, provider: createLMStudioProvider() };
  if (name === "qwen") return { name, provider: createQwenProvider() };

  throw new ProviderConfigurationError(
    "CAPTION_PROVIDER debe ser 'openai', 'lmstudio' o 'qwen'.",
  );
}
