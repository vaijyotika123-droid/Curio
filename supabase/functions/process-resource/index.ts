
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed.",
        },
      },
      405
    );
  }

  try {
    // 1. Authenticate the user.
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        },
        401
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(
        {
          error: {
            code: "SERVER_CONFIG_ERROR",
            message: "Server configuration is incomplete.",
          },
        },
        500
      );
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
      return jsonResponse(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or expired session.",
          },
        },
        401
      );
    }

    // 2. Validate the request body.
    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON.",
          },
        },
        400
      );
    }

    const resourceId = body?.resource_id;

    if (
      typeof resourceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        resourceId
      )
    ) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_RESOURCE_ID",
            message: "A valid resource_id is required.",
          },
        },
        400
      );
    }

    // 3. Verify resource ownership.
    const { data: resource, error: resourceError } = await userClient
      .from("resources")
      .select("id, title, user_id")
      .eq("id", resourceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (resourceError || !resource) {
      return jsonResponse(
        {
          error: {
            code: "RESOURCE_NOT_FOUND",
            message: "Resource not found.",
          },
        },
        404
      );
    }

    // 4. Verify that usable content exists.
    const { data: resourceContent, error: contentError } = await userClient
      .from("resource_contents")
      .select("content_text")
      .eq("resource_id", resourceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (contentError || !resourceContent?.content_text?.trim()) {
      return jsonResponse(
        {
          error: {
            code: "CONTENT_NOT_FOUND",
            message: "No usable resource content was found.",
          },
        },
        404
      );
    }

    // 5. Create the trusted admin client.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 6. Enqueue the overview generation job.
    const { data: jobRows, error: enqueueError } = await adminClient.rpc(
      "enqueue_processing_job",
      {
        p_resource_id: resourceId,
        p_user_id: user.id,
        p_job_type: "ai_analysis",
      }
    );

    if (enqueueError) {
      console.error("Could not enqueue AI analysis job:", enqueueError);

      throw new Error("Could not schedule resource analysis.");
    }

    const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;

    if (!job?.id || !job?.status) {
      throw new Error("The job queue did not return a valid job.");
    }

    // 7. Update the resource's visible analysis status.
    const { error: statusError } = await adminClient
      .from("resources")
      .update({ ai_analysis_status: "processing" })
      .eq("id", resourceId)
      .eq("user_id", user.id);

    if (statusError) {
      console.error("Could not update resource analysis status:", statusError);
      throw new Error("Could not update resource processing status.");
    }

    console.log("AI analysis job enqueued.", {
      resourceId,
      jobId: job.id,
      status: job.status,
      attemptNumber: job.attempt_number,
    });

    return jsonResponse(
      {
        success: true,
        resource_id: resourceId,
        job_id: job.id,
        status: job.status,
        message: "Resource analysis has been queued.",
      },
      202
    );
  } catch (error) {
    console.error("Resource processing request failed:", error);

    return jsonResponse(
      {
        error: {
          code: "PROCESSING_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Resource processing could not be started.",
        },
      },
      500
    );
  }
});
