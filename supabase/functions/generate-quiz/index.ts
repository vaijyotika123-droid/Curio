
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

import { QUIZ_SYSTEM_PROMPT } from "../_shared/ai/prompts.ts";
import type { AIRequest, AIResponse } from "../_shared/ai/provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const QUESTION_COUNT = 5;
const OPTIONS_PER_QUESTION = 4;
const PROMPT_VERSION = "resource-quiz-v1";
const SCHEMA_VERSION = "1";

const PRIMARY_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODEL = "gemini-3.8-flash";

// Quiz-specific limits. Other AI features are unaffected.
const MODEL_TIMEOUT_MS = 18_000;
const RETRY_DELAY_MS = 750;
const RETRYABLE_STATUS_CODES = new Set([
  408, 429, 500, 502, 503, 504,
]);

type QuizQuestion = {
  id: string;
  question: string;
  options: {
    id: string;
    text: string;
  }[];
};

type QuizAnswer = {
  correctOptionId: string;
  explanation: string;
};

type GeneratedQuiz = {
  questions: QuizQuestion[];
  answerKey: Record<string, QuizAnswer>;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validateGeneratedQuiz(data: unknown): GeneratedQuiz {
  if (!isRecord(data)) {
    throw new Error("Quiz response must be a JSON object.");
  }

  const questions = data.questions;
  const answerKey = data.answerKey;

  if (!Array.isArray(questions) || questions.length !== QUESTION_COUNT) {
    throw new Error("Quiz must contain exactly five questions.");
  }

  if (!isRecord(answerKey)) {
    throw new Error("Quiz answer key must be an object.");
  }

  const questionIds = new Set<string>();
  const sanitizedQuestions: QuizQuestion[] = [];

  for (const question of questions) {
    if (!isRecord(question)) {
      throw new Error("Invalid question structure.");
    }

    if (
      typeof question.id !== "string" ||
      !question.id.trim() ||
      typeof question.question !== "string" ||
      !question.question.trim() ||
      !Array.isArray(question.options) ||
      question.options.length !== OPTIONS_PER_QUESTION
    ) {
      throw new Error("A question has an invalid structure.");
    }

    if (questionIds.has(question.id)) {
      throw new Error("Question IDs must be unique.");
    }

    questionIds.add(question.id);

    const optionIds = new Set<string>();
    const sanitizedOptions: QuizQuestion["options"] = [];

    for (const option of question.options) {
      if (
        !isRecord(option) ||
        typeof option.id !== "string" ||
        !option.id.trim() ||
        typeof option.text !== "string" ||
        !option.text.trim()
      ) {
        throw new Error("A question contains an invalid option.");
      }

      if (optionIds.has(option.id)) {
        throw new Error("Option IDs must be unique per question.");
      }

      optionIds.add(option.id);

      sanitizedOptions.push({
        id: option.id,
        text: option.text,
      });
    }

    sanitizedQuestions.push({
      id: question.id,
      question: question.question,
      options: sanitizedOptions,
    });
  }

  const answerIds = Object.keys(answerKey);

  if (
    answerIds.length !== QUESTION_COUNT ||
    !answerIds.every((id) => questionIds.has(id))
  ) {
    throw new Error("Answer key does not match the questions.");
  }

  const sanitizedAnswerKey: Record<string, QuizAnswer> = {};

  for (const question of sanitizedQuestions) {
    const answer = answerKey[question.id];

    if (
      !isRecord(answer) ||
      typeof answer.correctOptionId !== "string" ||
      typeof answer.explanation !== "string" ||
      !answer.explanation.trim()
    ) {
      throw new Error("An answer has an invalid structure.");
    }

    const validOption = question.options.some(
      (option) => option.id === answer.correctOptionId
    );

    if (!validOption) {
      throw new Error("An answer references an unknown option.");
    }

    sanitizedAnswerKey[question.id] = {
      correctOptionId: answer.correctOptionId,
      explanation: answer.explanation,
    };
  }

  return {
    questions: sanitizedQuestions,
    answerKey: sanitizedAnswerKey,
  };
}

async function createFingerprint(
  title: string,
  content: string,
  provider: string,
  model: string
): Promise<string> {
  const input = new TextEncoder().encode(
    [
      title,
      content,
      PROMPT_VERSION,
      SCHEMA_VERSION,
      provider,
      model,
      "temperature=0.2",
      "questions=5",
      "options=4",
    ].join("\n")
  );

  const digest = await crypto.subtle.digest("SHA-256", input);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class GeminiTemporaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiTemporaryError";
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /timed out|timeout/i.test(error.message)
  );
}

async function callGemini(
  model: string,
  request: AIRequest,
  timeoutMs: number
): Promise<AIResponse> {
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
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
      }
    );

    if (!response.ok) {
      const details = await response.text();
      const message =
        `Gemini API request failed (${response.status}): ${details}`;

      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        throw new GeminiTemporaryError(message);
      }

      throw new Error(message);
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
        `Gemini response did not finish normally. Finish reason: ${
          finishReason ?? "UNKNOWN"
        }.`
      );
    }

    console.log(`Gemini ${model} completed successfully.`);

    return {
      text: generatedText,
      provider: "gemini",
      model,
    };
  } catch (error) {
    if (controller.signal.aborted || isTimeoutError(error)) {
      throw new GeminiTemporaryError(
        `Gemini ${model} timed out.`
      );
    }

    if (
      error instanceof TypeError &&
      /fetch|network/i.test(error.message)
    ) {
      throw new GeminiTemporaryError(
        `Gemini ${model} network error: ${error.message}`
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generateQuizWithFallback(
  request: AIRequest
): Promise<AIResponse> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];

  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const maxAttempts = index === 0 ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(
          `Quiz Gemini ${model}: attempt ${attempt}/${maxAttempts}`
        );

        return await callGemini(
          model,
          request,
          MODEL_TIMEOUT_MS
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        console.warn(
          `Quiz Gemini ${model} failed: ${message}`
        );

        // Do not retry permanent API errors or invalid responses.
        if (!(error instanceof GeminiTemporaryError)) {
          throw error;
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAY_MS)
          );
          continue;
        }

        if (index < models.length - 1) {
          console.warn(
            `Switching quiz generation to fallback model ${FALLBACK_MODEL}.`
          );
          break;
        }

        throw new Error(
  "Gemini is temporarily unavailable. Please try generating the quiz again shortly.",
  { cause: error }
);
      }
    }
  }

  throw new Error("Quiz generation could not be completed.");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed.",
      },
    }, 405);
  }

  try {
    // 1. Authenticate the user.
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required.",
        },
      }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({
        error: {
          code: "SERVER_CONFIG_ERROR",
          message: "Server configuration is incomplete.",
        },
      }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or expired session.",
        },
      }, 401);
    }

    // 2. Validate request.
    let body: Record<string, unknown>;

    try {
      const parsedBody: unknown = await req.json();

      if (!isRecord(parsedBody)) {
        throw new Error("Invalid request body.");
      }

      body = parsedBody;
    } catch {
      return jsonResponse({
        error: {
          code: "INVALID_JSON",
          message: "Request body must be a valid JSON object.",
        },
      }, 400);
    }

    const resourceId = body.resource_id;
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      typeof resourceId !== "string" ||
      !uuidPattern.test(resourceId)
    ) {
      return jsonResponse({
        error: {
          code: "INVALID_RESOURCE_ID",
          message: "A valid resource_id is required.",
        },
      }, 400);
    }

    // 3. Verify resource ownership.
    const { data: resource, error: resourceError } = await userClient
      .from("resources")
      .select("id, title, user_id")
      .eq("id", resourceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (resourceError || !resource) {
      return jsonResponse({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Resource not found.",
        },
      }, 404);
    }

    // 4. Fetch latest saved resource content.
    const { data: resourceContent, error: contentError } =
      await userClient
        .from("resource_contents")
        .select("content_text")
        .eq("resource_id", resourceId)
        .eq("user_id", user.id)
        .order("content_version", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (contentError || !resourceContent?.content_text?.trim()) {
      return jsonResponse({
        error: {
          code: "CONTENT_NOT_FOUND",
          message: "No usable resource content was found.",
        },
      }, 404);
    }

    // 5. Generate quiz using primary or fallback Gemini model.
    const quizRequest: AIRequest = {
      messages: [
        {
          role: "system",
          content: QUIZ_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Generate a quiz from this resource.

Title: ${resource.title}

Resource content:

${resourceContent.content_text}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 6000,
    };

    const response = await generateQuizWithFallback(quizRequest);

    let parsedResponse: unknown;

    try {
      parsedResponse = JSON.parse(response.text);
    } catch {
      throw new Error("AI returned an invalid JSON response.");
    }

    const quiz = validateGeneratedQuiz(parsedResponse);

    // 6. Fingerprint using the actual model used.
    const inputFingerprint = await createFingerprint(
      resource.title,
      resourceContent.content_text,
      response.provider,
      response.model
    );

    // 7. Save quiz and attempt atomically.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: savedQuiz, error: saveError } = await adminClient
      .rpc("create_quiz_with_attempt", {
        p_user_id: user.id,
        p_resource_id: resourceId,
        p_question_set: quiz.questions,
        p_answer_key: quiz.answerKey,
        p_total_questions: QUESTION_COUNT,
        p_input_fingerprint: inputFingerprint,
        p_model_provider: response.provider,
        p_model_name: response.model,
        p_prompt_version: PROMPT_VERSION,
      })
      .single();

    if (saveError || !savedQuiz) {
      console.error("Quiz save failed:", saveError);
      throw new Error("Could not save the generated quiz.");
    }

    // 8. Return questions only. Never expose the answer key.
    return jsonResponse({
      success: true,
      quiz_id: savedQuiz.quiz_id,
      attempt_id: savedQuiz.attempt_id,
      questions: savedQuiz.question_set,
      total_questions: savedQuiz.total_questions,
      created: savedQuiz.created,
    }, 200);
  } catch (error) {
    console.error("Quiz generation failed:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return jsonResponse({
      error: {
        code: "QUIZ_GENERATION_FAILED",
        message: error instanceof Error
          ? error.message
          : "Quiz generation failed.",
      },
    }, 500);
  }
});
