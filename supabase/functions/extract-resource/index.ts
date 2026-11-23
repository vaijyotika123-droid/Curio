
import { createClient } from "npm:@supabase/supabase-js@2";

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Database = {
  public: {
    Tables: {
      resources: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          source_url: string | null;
          extraction_status: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string;
          title?: string | null;
          source_url?: string | null;
          extraction_status?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string | null;
          source_url?: string | null;
          extraction_status?: string | null;
        };
        Relationships: [];
      };
      resource_contents: {
        Row: {
          id: string;
          resource_id: string;
          user_id: string;
          content_text: string | null;
          content_source: string | null;
          content_version: number | null;
        };
        Insert: {
          id?: string;
          resource_id?: string;
          user_id?: string;
          content_text?: string | null;
          content_source?: string | null;
          content_version?: number | null;
        };
        Update: {
          id?: string;
          resource_id?: string;
          user_id?: string;
          content_text?: string | null;
          content_source?: string | null;
          content_version?: number | null;
        };
        Relationships: [];
      };
      processing_jobs: {
        Row: {
          id: string;
          resource_id: string;
          user_id: string;
          job_type: string;
          status: string;
          attempt_number: number;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          resource_id: string;
          user_id: string;
          job_type: string;
          status: string;
          attempt_number: number;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          resource_id?: string;
          user_id?: string;
          job_type?: string;
          status?: string;
          attempt_number?: number;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JINA_READER_URL = "https://r.jina.ai/";
const MAX_CONTENT_LENGTH = 100_000;
const MAX_JINA_RESPONSE_BYTES = 2_000_000;
const MAX_URL_LENGTH = 2048;
const JINA_TIMEOUT_MS = 45_000;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Validate the submitted URL before passing it to Jina.
 *
 * This is a defensive input check, not a replacement for
 * network-level SSRF protection at the extraction provider.
 */
function validatePublicUrl(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_URL_LENGTH
  ) {
    throw new Error("The source URL is invalid or too long.");
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("The source URL is not a valid URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  if (url.username || url.password) {
    throw new Error(
      "URLs containing login credentials are not supported.",
    );
  }

  let hostname = url.hostname.toLowerCase();

  // IPv6 is intentionally excluded from the current MVP.
  if (hostname.includes(":") || hostname.startsWith("[")) {
    throw new Error("IPv6 URLs are not currently supported.");
  }

  hostname = hostname.replace(/\.$/, "");

  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".onion")
  ) {
    throw new Error("This URL is not publicly accessible.");
  }

  // Validate IPv4 addresses, including reserved/private ranges.
  if (/^[0-9.]+$/.test(hostname)) {
    const parts = hostname.split(".");

    if (
      parts.length !== 4 ||
      parts.some(
        (part) =>
          !/^\d{1,3}$/.test(part) ||
          Number(part) < 0 ||
          Number(part) > 255,
      )
    ) {
      throw new Error("The IP address in this URL is invalid.");
    }

    const [a, b, c] = parts.map(Number);

    const blocked =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224;

    if (blocked) {
      throw new Error(
        "This IP address is not publicly accessible.",
      );
    }
  } else {
    // Reject single-label hostnames and malformed DNS names.
    if (
      !hostname.includes(".") ||
      hostname.length > 253 ||
      hostname.split(".").some(
        (label) =>
          !label ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
      )
    ) {
      throw new Error(
        "This hostname is not a valid public domain.",
      );
    }
  }

  // Remove fragments because they are not sent to the web server.
  url.hash = "";

  return url.toString();
}

/**
 * Read a response with a strict byte limit.
 */
async function readLimitedResponse(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");

  if (contentLength && Number(contentLength) > maxBytes) {
    await response.body?.cancel();

    throw new Error(
      "The extraction response exceeded the allowed size.",
    );
  }

  if (!response.body) {
    throw new Error(
      "The extraction service returned an empty response.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let totalBytes = 0;
  let result = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();

        throw new Error(
          "The extraction response exceeded the allowed size.",
        );
      }

      result += decoder.decode(value, { stream: true });
    }

    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Normalize an article title for matching.
 *
 * Ignores capitalization, punctuation, and extra whitespace.
 */
function normalizeArticleTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Conservatively isolate an intended article from a
 * multi-article PDF extraction.
 *
 * Safety rules:
 * - Only process PDF URLs.
 * - Require an exact normalized title match.
 * - Require a unique target heading.
 * - Recognize the next article only after a journal-style
 *   "Supporting Online Material" section.
 * - Reject suspiciously short cleaned results.
 * - Never trim ordinary webpages.
 *
 * If the boundaries cannot be identified confidently,
 * return the original content unchanged.
 */
function cleanMultiArticlePdf(
  content: string,
  expectedTitle: string | null,
  sourceUrl: string,
): string {
  const pathname = new URL(sourceUrl).pathname.toLowerCase();

  if (!pathname.endsWith(".pdf")) {
    return content;
  }

  if (
    !expectedTitle ||
    normalizeArticleTitle(expectedTitle).length < 20
  ) {
    console.warn(
      "PDF cleanup skipped: missing or insufficient title.",
    );
    return content;
  }

  const lines = content.split(/\r?\n/);
  const targetTitle = normalizeArticleTitle(expectedTitle);

  const titleMatches: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^#{1,3}\s+(.+?)\s*$/);

    if (
      heading &&
      normalizeArticleTitle(heading[1]) === targetTitle
    ) {
      titleMatches.push(i);
    }
  }

  if (titleMatches.length !== 1) {
    console.warn(
      "PDF cleanup skipped: title match not unique.",
      { matches: titleMatches.length },
    );

    return content;
  }

  const start = titleMatches[0];

  let end = lines.length;
  let supportingMaterialSeen = false;

  for (let i = start + 1; i < lines.length; i++) {
    const normalized = normalizeArticleTitle(
      lines[i].replace(/^#+\s*/, ""),
    );

    if (normalized === "supporting online material") {
      supportingMaterialSeen = true;
      continue;
    }

    if (!supportingMaterialSeen) {
      continue;
    }

    const heading = lines[i].match(/^#\s+(.+?)\s*$/);

    if (!heading) {
      continue;
    }

    const candidate = normalizeArticleTitle(heading[1]);

    if (
      candidate.length >= 25 &&
      candidate !== targetTitle &&
      candidate.split(" ").length >= 4
    ) {
      end = i;
      break;
    }
  }

  // Without a reliable end boundary, preserve the source.
  if (end === lines.length) {
    console.warn(
      "PDF cleanup skipped: next article boundary not found.",
    );
    return content;
  }

  const cleaned = lines.slice(start, end).join("\n").trim();

  if (cleaned.length < 1000) {
    console.warn(
      "PDF cleanup skipped: cleaned result too short.",
    );
    return content;
  }

  console.log("Multi-article PDF cleaned.", {
    originalCharacters: content.length,
    cleanedCharacters: cleaned.length,
    removedCharacters: content.length - cleaned.length,
  });

  return cleaned;
}

/**
 * Ask Jina Reader to fetch the webpage and return readable content.
 */
async function extractWithJina(
  sourceUrl: string,
  apiKey: string,
): Promise<{ title: string | null; content: string }> {
  const safeUrl = validatePublicUrl(sourceUrl);

  let response: Response;

  try {
    response = await fetch(JINA_READER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        url: safeUrl,
      }),
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "TimeoutError"
    ) {
      throw new Error(
        "The webpage extraction request timed out.",
        { cause: error },
      );
    }

    throw new Error(
      "Could not connect to the extraction service.",
      { cause: error },
    );
  }

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(
      `The extraction service returned HTTP ${response.status}.`,
    );
  }

  const responseText = await readLimitedResponse(
    response,
    MAX_JINA_RESPONSE_BYTES,
  );

  let result: unknown;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      "The extraction service returned invalid JSON.",
    );
  }

  if (
    !result ||
    typeof result !== "object" ||
    !("data" in result) ||
    !result.data ||
    typeof result.data !== "object"
  ) {
    throw new Error(
      "The extraction service returned an invalid response.",
    );
  }

  const data = result.data as Record<string, unknown>;

  if (typeof data.content !== "string") {
    throw new Error(
      "The webpage content could not be extracted.",
    );
  }

  const content = data.content.trim();

  if (!content) {
    throw new Error("The webpage returned empty content.");
  }

  if (content.length < 100) {
    throw new Error(
      "Not enough readable content could be extracted from this webpage.",
    );
  }

  return {
    title:
      typeof data.title === "string" ? data.title : null,
    content: content.slice(0, MAX_CONTENT_LENGTH),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed." },
      405,
    );
  }

  let resourceId: string | null = null;
  let userId: string | null = null;
  let adminClient: SupabaseClient<Database> | null = null;
  let processingJobId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    const jinaApiKey = Deno.env.get("JINA_API_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error(
        "Supabase environment variables are missing.",
      );
    }

    if (!jinaApiKey) {
      throw new Error(
        "The Jina API key is not configured.",
      );
    }

    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse(
        { error: "Authorization required." },
        401,
      );
    }

    // Authenticate the user.
    const userClient = createClient<Database>(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      },
    );

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse(
        { error: "Invalid or expired session." },
        401,
      );
    }

    userId = user.id;

    // Validate request body.
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: "Invalid JSON request body." },
        400,
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return jsonResponse(
        { error: "Invalid request body." },
        400,
      );
    }

    const requestBody = body as Record<string, unknown>;

    resourceId =
      typeof requestBody.resource_id === "string"
        ? requestBody.resource_id
        : null;

    if (
      !resourceId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        resourceId,
      )
    ) {
      return jsonResponse(
        { error: "A valid resource_id is required." },
        400,
      );
    }

    adminClient = createClient<Database>(
      supabaseUrl,
      serviceRoleKey,
    );

    // Verify that the resource belongs to the user.
    const {
      data: resource,
      error: resourceError,
    } = await adminClient
      .from("resources")
      .select("id, source_url, title")
      .eq("id", resourceId)
      .eq("user_id", userId)
      .single();

    if (resourceError || !resource) {
      return jsonResponse(
        { error: "Resource not found." },
        404,
      );
    }

    if (!resource.source_url) {
      return jsonResponse(
        {
          error:
            "This resource does not have a source URL.",
        },
        400,
      );
    }

    const safeUrl = validatePublicUrl(resource.source_url);

    // Find the latest queued extraction job.
    const {
      data: queuedJob,
      error: jobLookupError,
    } = await adminClient
      .from("processing_jobs")
      .select("id, attempt_number")
      .eq("resource_id", resourceId)
      .eq("user_id", userId)
      .eq("job_type", "content_extraction")
      .eq("status", "queued")
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (jobLookupError) {
      throw new Error(
        `Could not find the extraction job: ${jobLookupError.message}`,
      );
    }

    if (!queuedJob) {
      return jsonResponse(
        {
          error:
            "No queued extraction job exists for this resource. It may already be processing or completed.",
        },
        409,
      );
    }

    // Atomically claim the queued job.
    const startedAt = new Date().toISOString();

    const {
      data: claimedJob,
      error: claimError,
    } = await adminClient
      .from("processing_jobs")
      .update({
        status: "processing",
        started_at: startedAt,
        completed_at: null,
        error_message: null,
      })
      .eq("id", queuedJob.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (claimError) {
      throw new Error(
        `Could not claim the extraction job: ${claimError.message}`,
      );
    }

    if (!claimedJob) {
      return jsonResponse(
        {
          error:
            "This extraction job has already been claimed by another request.",
        },
        409,
      );
    }

    processingJobId = claimedJob.id;

    // Mark extraction as processing.
    const {
      error: processingStatusError,
    } = await adminClient
      .from("resources")
      .update({
        extraction_status: "processing",
      })
      .eq("id", resourceId)
      .eq("user_id", userId);

    if (processingStatusError) {
      throw new Error(
        `Could not update extraction status: ${processingStatusError.message}`,
      );
    }

    console.log("Resource extraction started.", {
      resourceId,
      processingJobId,
      attemptNumber: queuedJob.attempt_number,
    });

    // Extract article content through Jina Reader.
    const extracted = await extractWithJina(
      safeUrl,
      jinaApiKey,
    );

    // Clean recognizable multi-article PDFs before storage.
    const extractedText = cleanMultiArticlePdf(
      extracted.content,
      resource.title,
      safeUrl,
    );

    // Check whether content already exists.
    const {
      data: existingContent,
      error: contentLookupError,
    } = await adminClient
      .from("resource_contents")
      .select("id, content_version")
      .eq("resource_id", resourceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (contentLookupError) {
      throw new Error(
        `Could not check existing resource content: ${contentLookupError.message}`,
      );
    }

    const contentVersion = existingContent
      ? (existingContent.content_version ?? 0) + 1
      : 1;

    if (existingContent) {
      const {
        error: updateError,
      } = await adminClient
        .from("resource_contents")
        .update({
          content_text: extractedText,
          content_source: "url_extraction",
          content_version: contentVersion,
        })
        .eq("id", existingContent.id)
        .eq("user_id", userId);

      if (updateError) {
        throw new Error(
          `Could not save extracted content: ${updateError.message}`,
        );
      }
    } else {
      const {
        error: insertError,
      } = await adminClient
        .from("resource_contents")
        .insert({
          resource_id: resourceId,
          user_id: userId,
          content_text: extractedText,
          content_source: "url_extraction",
          content_version: contentVersion,
        });

      if (insertError) {
        throw new Error(
          `Could not save extracted content: ${insertError.message}`,
        );
      }
    }

    // Mark extraction as completed.
    const {
      error: statusError,
    } = await adminClient
      .from("resources")
      .update({
        extraction_status: "completed",
      })
      .eq("id", resourceId)
      .eq("user_id", userId);

    if (statusError) {
      throw new Error(
        `Content was saved, but extraction status could not be updated: ${statusError.message}`,
      );
    }

    // Mark the processing job as completed.
    const completedAt = new Date().toISOString();

    const {
      error: jobCompletionError,
    } = await adminClient
      .from("processing_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        error_message: null,
      })
      .eq("id", processingJobId)
      .eq("status", "processing");

    if (jobCompletionError) {
      throw new Error(
        `Content was saved, but the extraction job could not be completed: ${jobCompletionError.message}`,
      );
    }

    console.log("Resource extraction completed.", {
      resourceId,
      processingJobId,
      extractedCharacters: extractedText.length,
      contentVersion,
    });

    return jsonResponse({
      success: true,
      resource_id: resourceId,
      extracted_characters: extractedText.length,
      content_version: contentVersion,
      extraction_status: "completed",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected extraction error occurred.";

    console.error("Resource extraction failed:", {
      resourceId,
      processingJobId,
      message,
    });

    if (adminClient && resourceId && userId) {
      const completedAt = new Date().toISOString();

      // Mark the claimed processing job as failed.
      if (processingJobId) {
        const {
          error: jobFailureError,
        } = await adminClient
          .from("processing_jobs")
          .update({
            status: "failed",
            error_message: message.slice(0, 2000),
            completed_at: completedAt,
          })
          .eq("id", processingJobId)
          .eq("status", "processing");

        if (jobFailureError) {
          console.error(
            "Could not update extraction job failure status:",
            jobFailureError.message,
          );
        }
      }

      // Mark the resource extraction as failed.
      const {
        error: resourceFailureError,
      } = await adminClient
        .from("resources")
        .update({
          extraction_status: "failed",
        })
        .eq("id", resourceId)
        .eq("user_id", userId);

      if (resourceFailureError) {
        console.error(
          "Could not update extraction failure status:",
          resourceFailureError.message,
        );
      }
    }

    return jsonResponse(
      {
        success: false,
        error: message,
      },
      500,
    );
  }
});
