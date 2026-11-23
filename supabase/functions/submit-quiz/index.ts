
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type QuizQuestion = {
  id: string;
  question: string;
  options: { id: string; text: string }[];
};

type QuizAnswer = {
  correctOptionId: string;
  explanation: string;
};

function respond(data: unknown, status = 200): Response {
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return respond({ error: "Authentication required." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return respond({ error: "Server configuration missing." }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return respond({ error: "Invalid or expired session." }, 401);
    }

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return respond({ error: "Invalid JSON request." }, 400);
    }

    if (!isRecord(body)) {
      return respond({ error: "Invalid request body." }, 400);
    }

    const attemptId = body.attempt_id;
    const submittedAnswers = body.answers;

    if (
      typeof attemptId !== "string" ||
      !uuidPattern.test(attemptId) ||
      !isRecord(submittedAnswers)
    ) {
      return respond({
        error: "Valid attempt_id and answers are required.",
      }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Load only the authenticated user's attempt.
    const { data: attempt, error: attemptError } = await admin
      .from("quiz_attempts")
      .select("id, quiz_id, status, total_questions")
      .eq("id", attemptId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (attemptError) {
      throw new Error("Could not load quiz attempt.");
    }

    if (!attempt) {
      return respond({ error: "Quiz attempt not found." }, 404);
    }

    if (attempt.status !== "in_progress") {
      return respond({
        error: "This quiz has already been submitted.",
      }, 409);
    }

    // The answer key is accessed only by the trusted backend.
    const { data: quiz, error: quizError } = await admin
      .from("quizzes")
      .select("id, question_set, answer_key")
      .eq("id", attempt.quiz_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (quizError || !quiz) {
      throw new Error("Could not load quiz for grading.");
    }

    const questions = quiz.question_set as QuizQuestion[];
    const answerKey = quiz.answer_key as Record<string, QuizAnswer>;

    if (
      !Array.isArray(questions) ||
      questions.length !== 5 ||
      attempt.total_questions !== questions.length ||
      !isRecord(answerKey)
    ) {
      throw new Error("Stored quiz data is invalid.");
    }

    const questionIds = questions.map((question) => question.id);
    const submittedIds = Object.keys(submittedAnswers);

    if (
      new Set(questionIds).size !== questions.length ||
      submittedIds.length !== questions.length ||
      !submittedIds.every((id) => questionIds.includes(id))
    ) {
      return respond({
        error: "Please answer all five questions before submitting.",
      }, 400);
    }

    let score = 0;

    const results = [];

    for (const question of questions) {
      const selectedOptionId = submittedAnswers[question.id];
      const correctAnswer = answerKey[question.id];

      if (
        typeof selectedOptionId !== "string" ||
        !question.options.some(
          (option) => option.id === selectedOptionId
        )
      ) {
        return respond({
          error: "One or more selected answers are invalid.",
        }, 400);
      }

      if (
        !correctAnswer ||
        typeof correctAnswer.correctOptionId !== "string" ||
        typeof correctAnswer.explanation !== "string" ||
        !question.options.some(
          (option) =>
            option.id === correctAnswer.correctOptionId
        )
      ) {
        throw new Error("Stored answer key is invalid.");
      }

      const isCorrect =
        selectedOptionId === correctAnswer.correctOptionId;

      if (isCorrect) {
        score += 1;
      }

      results.push({
        questionId: question.id,
        selectedOptionId,
        correctOptionId: correctAnswer.correctOptionId,
        isCorrect,
        explanation: correctAnswer.explanation,
      });
    }

    // Only an in-progress attempt can be completed.
    // The conditional update prevents a second submission
    // from overwriting a completed attempt.
    const { data: completedAttempt, error: updateError } = await admin
      .from("quiz_attempts")
      .update({
        answers: submittedAnswers,
        score,
        status: "completed",
        submitted_at: new Date().toISOString(),
      })
      .eq("id", attempt.id)
      .eq("user_id", user.id)
      .eq("status", "in_progress")
      .select("id, score, total_questions, submitted_at")
      .maybeSingle();

    if (updateError) {
      throw new Error("Could not save quiz results.");
    }

    if (!completedAttempt) {
      return respond({
        error: "This quiz has already been submitted.",
      }, 409);
    }

    return respond({
      success: true,
      attempt_id: completedAttempt.id,
      score: completedAttempt.score,
      total_questions: completedAttempt.total_questions,
      percentage: Math.round(
        (completedAttempt.score /
          completedAttempt.total_questions) * 100
      ),
      submitted_at: completedAttempt.submitted_at,
      results,
    });
  } catch (error) {
    console.error("Quiz submission failed:", error);

    return respond({
      error: "Unable to submit quiz. Please try again.",
    }, 500);
  }
});
