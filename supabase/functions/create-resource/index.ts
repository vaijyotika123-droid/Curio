import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY_BYTES = 512 * 1024; // 512 KB request body limit


function normalizeUrl(rawUrl: unknown): { originalUrl: string } {
  if (typeof rawUrl !== "string") {
    throw new Error("source_url must be a string.");
  }

  // Reject raw whitespace and backslashes
  if (/[\s\\]/.test(rawUrl)) {
    throw new Error("URL cannot contain raw whitespace or backslashes.");
  }

  const originalUrl = rawUrl.trim();

  if (originalUrl.length === 0) {
    throw new Error("source_url cannot be empty.");
  }

  if (originalUrl.length > 2048) {
    throw new Error("source_url exceeds maximum allowed length of 2048 characters.");
  }

  let parsed: URL;

  try {
    parsed = new URL(originalUrl);
  } catch {
    throw new Error("Invalid URL syntax.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS protocols are supported.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("User credentials (userinfo) in URLs are not supported.");
  }

  if (!parsed.hostname) {
    throw new Error("URL must contain a valid non-empty hostname.");
  }

  // Reject IP address literals for the MVP
  if (
    parsed.hostname.startsWith("[") ||
    /^\d+(?:\.\d+)*$/.test(parsed.hostname)
  ) {
    throw new Error("IP address URLs are not supported.");
  }

  // Validate standard DNS hostname syntax
  const hostname = parsed.hostname;

  if (
    hostname.length > 253 ||
    !/^[a-zA-Z0-9.-]+$/.test(hostname) ||
    hostname.startsWith(".") ||
    hostname.endsWith(".") ||
    hostname.includes("..") ||
    hostname.split(".").some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-")
    )
  ) {
    throw new Error("Invalid or malformed hostname in URL.");
  }

  return { originalUrl };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization header" } }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: { code: "SERVER_CONFIG_ERROR", message: "Server configuration error." } }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentLengthHeader = req.headers.get("content-length");
    if (contentLengthHeader) {
      if (!/^\d+$/.test(contentLengthHeader)) {
        return new Response(
          JSON.stringify({ error: { code: "INVALID_CONTENT_LENGTH", message: "Invalid Content-Length header." } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const parsedLength = parseInt(contentLengthHeader, 10);
      if (parsedLength > MAX_BODY_BYTES) {
        return new Response(
          JSON.stringify({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the 512KB size limit." } }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let rawBodyText: string;
    try {
      const reader = req.body?.getReader();
      if (!reader) {
        throw new Error("Missing request body stream.");
      }
      let receivedBytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.length;
        if (receivedBytes > MAX_BODY_BYTES) {
          try {
            await reader.cancel("Payload too large");
          } catch {
            // Ignore cancellation error
          }
          return new Response(
            JSON.stringify({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the 512KB size limit." } }),
            { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        chunks.push(value);
      }
      const combined = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      rawBodyText = new TextDecoder().decode(combined);
    } catch {
      return new Response(
        JSON.stringify({ error: { code: "INVALID_BODY", message: "Failed to read request body." } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBodyText) as Record<string, unknown>;
    } catch {
      return new Response(
        JSON.stringify({ error: { code: "INVALID_JSON", message: "Malformed JSON payload." } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(
        JSON.stringify({ error: { code: "INVALID_BODY", message: "Request body must be a non-null JSON object." } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { input_method, title, source_url, content_text } = body;

    if (!input_method || typeof input_method !== "string" || !["url", "manual_text"].includes(input_method)) {
      return new Response(
        JSON.stringify({ error: { code: "INVALID_INPUT_METHOD", message: "A valid input_method ('url' or 'manual_text') is required." } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let finalSourceUrl: string | null = null;
    let finalTitle = "";
    let finalContentText: string | null = null;

    if (input_method === "url") {
      if (title !== undefined && title !== null) {
        if (typeof title !== "string") {
          return new Response(
            JSON.stringify({ error: { code: "INVALID_TITLE", message: "title must be a string." } }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        finalTitle = title.trim();
        if (finalTitle.length > 300) {
          return new Response(
            JSON.stringify({ error: { code: "TITLE_TOO_LONG", message: "title cannot exceed 300 characters." } }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      let normResult;
      try {
        normResult = normalizeUrl(source_url);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Invalid URL provided.";
        return new Response(
          JSON.stringify({ error: { code: "INVALID_URL", message: errorMessage } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      finalSourceUrl = normResult.originalUrl;
    } else if (input_method === "manual_text") {
      if (!title || typeof title !== "string") {
        return new Response(
          JSON.stringify({ error: { code: "MISSING_TITLE", message: "title is required and must be a string for manual text entry." } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      finalTitle = title.trim();
      if (finalTitle.length === 0 || finalTitle.length > 300) {
        return new Response(
          JSON.stringify({ error: { code: "INVALID_TITLE", message: "title must be between 1 and 300 characters." } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!content_text || typeof content_text !== "string") {
        return new Response(
          JSON.stringify({ error: { code: "MISSING_CONTENT", message: "content_text is required and must be a string for manual text entry." } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      finalContentText = content_text;
      if (finalContentText.trim().length === 0 || finalContentText.length > 100000) {
        return new Response(
          JSON.stringify({ error: { code: "INVALID_CONTENT", message: "content_text must be between 1 and 100,000 characters." } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid or expired session token." } }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc("create_resource_transaction", {
      p_input_method: input_method,
      p_title: finalTitle,
      p_source_url: finalSourceUrl,
      p_content_text: finalContentText,
    });

    if (rpcError) {
      console.error("RPC Error during resource creation:", rpcError);
      const isValidationError = rpcError.code?.startsWith('22') || rpcError.message?.includes('required') || rpcError.message?.includes('Invalid') || rpcError.message?.includes('supported') || rpcError.message?.includes('must contain');
      const statusCode = isValidationError ? 400 : 500;
      const errCode = isValidationError ? "VALIDATION_ERROR" : "DATABASE_ERROR";
      const errMsg = isValidationError ? rpcError.message : "An internal database error occurred while saving the resource.";
      
      return new Response(
        JSON.stringify({ error: { code: errCode, message: errMsg } }),
        { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isDuplicate = rpcResult?.is_duplicate === true;
    const statusCode = isDuplicate ? 200 : 201;

    return new Response(
      JSON.stringify(rpcResult),
      { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("Edge Function Unhandled Exception:", err);
    return new Response(
      JSON.stringify({ error: { code: "SERVER_ERROR", message: "An unexpected error occurred." } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});