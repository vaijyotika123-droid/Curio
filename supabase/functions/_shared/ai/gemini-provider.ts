
import type {
  AIProvider,
  AIRequest,
  AIResponse,
} from "./provider.ts";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS = [1000, 2000, 4000];

const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class GeminiProvider implements AIProvider {
  constructor(
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const apiKey = Deno.env.get("GEMINI_API_KEY");

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const systemInstruction = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const userContent = request.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n\n");

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        console.log(
          `Gemini ${this.model}: attempt ${attempt}/${MAX_ATTEMPTS}`
        );

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
          {
            method: "POST",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemInstruction }],
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: userContent }],
                },
              ],
              generationConfig: {
                maxOutputTokens: request.maxTokens ?? 2500,
                responseMimeType: "application/json",
              },
            }),
          },
        );

        if (!response.ok) {
          const details = await response.text();
          const error = new Error(
            `Gemini API request failed (${response.status}): ${details}`
          );

          if (!RETRYABLE_STATUS_CODES.includes(response.status)) {
            throw error;
          }

          lastError = error;

          if (attempt === MAX_ATTEMPTS) break;

          const delay = RETRY_DELAYS[attempt - 1];
          console.warn(
            `Gemini ${this.model} returned ${response.status}. Retrying in ${delay}ms.`
          );

          await wait(delay);
          continue;
        }

        const result = await response.json();
        const candidate = result.candidates?.[0];
        const finishReason = candidate?.finishReason;

        const generatedText = candidate?.content?.parts
          ?.map((part: { text?: string }) => part.text ?? "")
          .join("");

        if (finishReason === "MAX_TOKENS") {
          throw new Error(
            "Gemini response ended because the output token limit was reached."
          );
        }

        if (
          finishReason === "SAFETY" ||
          result.promptFeedback?.blockReason
        ) {
          throw new Error(
            "Gemini blocked the response due to safety restrictions."
          );
        }

        if (!generatedText || finishReason !== "STOP") {
          throw new Error(
            `Gemini response did not finish normally. Finish reason: ${finishReason ?? "UNKNOWN"}.`
          );
        }

        console.log(`Gemini ${this.model} completed successfully.`);

        return {
          text: generatedText,
          provider: "gemini",
          model: this.model,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown Gemini API error.";

        if (
          message.startsWith("Gemini API request failed") ||
          message.startsWith("Gemini response") ||
          message.startsWith("Gemini blocked")
        ) {
          throw error;
        }

        lastError =
          error instanceof Error ? error : new Error(message);

        if (attempt === MAX_ATTEMPTS) break;

        const delay = RETRY_DELAYS[attempt - 1];
        console.warn(
          `Gemini ${this.model} network error. Retrying in ${delay}ms.`,
          message
        );

        await wait(delay);
      }
    }

    throw new Error(
      `Gemini API failed after ${MAX_ATTEMPTS} attempts. ${
        lastError?.message ?? "Unknown error."
      }`
    );
  }
}
