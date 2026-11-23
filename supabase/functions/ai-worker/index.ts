
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

import { GeminiProvider } from "../_shared/ai/gemini-provider.ts";
import { analyzeResource } from "../_shared/ai/resource-analysis.ts";

type Job = {
  id: string;
  resource_id: string;
  user_id: string;
  job_type: string;
  attempt_number: number;
};

const PROMPT_VERSION = "resource-overview-v1";
const SCHEMA_VERSION = "1";

function respond(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getJwtRole(authorization: string | null): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  try {
    const token = authorization.slice(7);
    const parts = token.split(".");

    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const padded = payload.padEnd(
      Math.ceil(payload.length / 4) * 4,
      "="
    );

    const claims = JSON.parse(atob(padded));
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

async function createFingerprint(
  title: string,
  content: string
): Promise<string> {
  const bytes = new TextEncoder().encode(`${title}\n${content}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ error: "Worker configuration missing" }, 500);
  }

  // Supabase's gateway verifies the JWT signature.
  // This additional check restricts the worker to service-role callers.
  const role = getJwtRole(req.headers.get("Authorization"));

  if (role !== "service_role") {
    return respond({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: jobs, error: claimError } = await admin.rpc(
    "claim_processing_jobs",
    { p_batch_size: 1 }
  );

  if (claimError) {
    console.error("Job claim failed:", claimError);
    return respond({ error: "Unable to claim job" }, 500);
  }

  const job = (jobs as Job[] | null)?.[0];

  if (!job) {
    return respond({
      success: true,
      message: "No queued AI jobs",
      processed: 0,
    });
  }

  console.log("Claimed AI job", {
    jobId: job.id,
    resourceId: job.resource_id,
    jobType: job.job_type,
    attempt: job.attempt_number,
  });

  try {
    if (job.job_type !== "ai_analysis") {
      throw new Error(`Unsupported worker job type: ${job.job_type}`);
    }

    const { data: resource, error: resourceError } = await admin
      .from("resources")
      .select("id, title")
      .eq("id", job.resource_id)
      .eq("user_id", job.user_id)
      .single();

    if (resourceError || !resource) {
      throw new Error("Resource could not be loaded.");
    }

    const { data: resourceContent, error: contentError } = await admin
      .from("resource_contents")
      .select("content_text")
      .eq("resource_id", job.resource_id)
      .eq("user_id", job.user_id)
      .order("content_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (contentError || !resourceContent?.content_text?.trim()) {
      throw new Error("Resource content is unavailable.");
    }

    const content = resourceContent.content_text;
    const provider = new GeminiProvider();

    const result = await analyzeResource(
      provider,
      resource.title,
      content
    );

    const fingerprint = await createFingerprint(
      resource.title,
      content
    );

    const { data: savedRows, error: saveError } = await admin.rpc(
      "save_resource_overview",
      {
        p_user_id: job.user_id,
        p_resource_id: job.resource_id,
        p_output_data: result.overview,
        p_input_fingerprint: fingerprint,
        p_model_provider: result.provider,
        p_model_name: result.model,
        p_prompt_version: PROMPT_VERSION,
        p_output_schema_version: SCHEMA_VERSION,
      }
    );

    if (saveError) {
      console.error("Overview save failed:", saveError);
      throw new Error("Could not save the generated overview.");
    }

    const saved = Array.isArray(savedRows)
      ? savedRows[0]
      : savedRows;

    if (!saved?.output_id) {
      throw new Error("Overview save returned no output ID.");
    }

    const { error: resourceStatusError } = await admin
      .from("resources")
      .update({ ai_analysis_status: "completed" })
      .eq("id", job.resource_id)
      .eq("user_id", job.user_id);

    if (resourceStatusError) {
      throw new Error(
        `Could not update resource status: ${resourceStatusError.message}`
      );
    }

    const { error: completionError } = await admin
      .from("processing_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        error_message: null,
        result_data: {
          output_id: saved.output_id,
          created: saved.created,
        },
      })
      .eq("id", job.id)
      .eq("status", "processing");

    if (completionError) {
      throw new Error(
        `Could not complete job: ${completionError.message}`
      );
    }

    console.log("AI overview job completed", {
      jobId: job.id,
      outputId: saved.output_id,
    });

    return respond({
      success: true,
      processed: 1,
      job_id: job.id,
      status: "completed",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown worker error";

    console.error("AI worker job failed", {
      jobId: job.id,
      error: message,
    });

    const { error: jobUpdateError } = await admin
      .from("processing_jobs")
      .update({
        status: "failed",
        error_message: message.slice(0, 2000),
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "processing");

    if (jobUpdateError) {
      console.error("Could not mark job failed:", jobUpdateError);
    }

    const { error: resourceUpdateError } = await admin
      .from("resources")
      .update({ ai_analysis_status: "failed" })
      .eq("id", job.resource_id)
      .eq("user_id", job.user_id);

    if (resourceUpdateError) {
      console.error(
        "Could not update resource failure status:",
        resourceUpdateError
      );
    }

    return respond(
      {
        success: false,
        processed: 1,
        job_id: job.id,
        status: "failed",
        error: "AI processing failed. Check worker logs.",
      },
      500
    );
  }
});
