
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

import { GeminiProvider } from "../_shared/ai/gemini-provider.ts";

import type { AIRequest, AIResponse } from "../_shared/ai/provider.ts";

import {
  CONNECT_PROMPT_VERSION,
  CONNECT_SYSTEM_PROMPT,
} from "../_shared/ai/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MIN_RESOURCES = 2;
const MAX_RESOURCES = 5;
const MAX_CONTENT_CHARS = 12000;
const MAX_PASSAGE_CHARS = 650;
const MAX_CONNECTIONS = 4;

const PRIMARY_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";
const SCHEMA_VERSION = "1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SourceEvidence = {
  resource_id: string;
  excerpt: string;
};

type Connection = {
  title: string;
  explanation: string;
  relationship_type: string;
  resource_ids: string[];
  evidence: SourceEvidence[];
};

type ConnectionOutput = {
  summary: string;
  shared_themes: string[];
  connections: Connection[];
  unconnected_resource_ids: string[];
};

type ResourceInput = {
  id: string;
  title: string;
  content: string;
};

type Passage = {
  passage_id: string;
  resource_id: string;
  text: string;
};

type SavedConnection = {
  id: string;
  output_data: ConnectionOutput;
  model_name: string;
};

function jsonResponse(
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number
): Response {
  return jsonResponse(
    {
      success: false,
      error: { code, message },
    },
    status
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

/**
 * Divide source content into reasonably sized passages.
 * Prefer paragraph and sentence boundaries.
 * Preserve the original source wording.
 */
function splitIntoPassages(
  resource: ResourceInput
): Passage[] {
  const content = resource.content.trim();
  const chunks: string[] = [];

  const paragraphs = content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  let current = "";

  const flush = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  };

  const append = (text: string) => {
    if (!text.trim()) return;

    if (
      current &&
      current.length + text.length + 1 >
        MAX_PASSAGE_CHARS
    ) {
      flush();
    }

    current = current
      ? `${current} ${text}`
      : text;
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_PASSAGE_CHARS) {
      append(paragraph);
      continue;
    }

    flush();

    const sentences = paragraph.match(
      /[^.!?]+(?:[.!?]+|$)/g
    ) || [paragraph];

    for (const sentence of sentences) {
      const clean = sentence.trim();
      if (!clean) continue;

      if (clean.length <= MAX_PASSAGE_CHARS) {
        append(clean);
        continue;
      }

      flush();

      const words = clean.split(/\s+/);
      let piece = "";

      for (const word of words) {
        if (
          piece &&
          piece.length + word.length + 1 >
            MAX_PASSAGE_CHARS
        ) {
          chunks.push(piece);
          piece = "";
        }

        if (word.length > MAX_PASSAGE_CHARS) {
          if (piece) {
            chunks.push(piece);
            piece = "";
          }

          for (
            let start = 0;
            start < word.length;
            start += MAX_PASSAGE_CHARS
          ) {
            chunks.push(
              word.slice(
                start,
                start + MAX_PASSAGE_CHARS
              )
            );
          }
        } else {
          piece = piece
            ? `${piece} ${word}`
            : word;
        }
      }

      if (piece) chunks.push(piece);
    }

    flush();
  }

  flush();

  return chunks.map((text, index) => ({
    passage_id: `${resource.id}:p${index + 1}`,
    resource_id: resource.id,
    text,
  }));
}

/**
 * Gemini returns passage references, not excerpts.
 * The backend resolves those references into
 * exact source text.
 */
function validateConnectionOutput(
  data: unknown,
  resources: ResourceInput[],
  passages: Passage[]
): ConnectionOutput {
  if (!isRecord(data)) {
    throw new Error(
      "Connect response must be a JSON object."
    );
  }

  if (!isNonEmptyString(data.summary)) {
    throw new Error(
      "Connect response is missing its summary."
    );
  }

  if (
    !Array.isArray(data.shared_themes) ||
    !data.shared_themes.every(isNonEmptyString)
  ) {
    throw new Error("Invalid shared themes.");
  }

  if (
    !Array.isArray(data.connections) ||
    data.connections.length > MAX_CONNECTIONS
  ) {
    throw new Error(
      "Connections must be an array of at most 4 items."
    );
  }

  if (
    !Array.isArray(data.unconnected_resource_ids)
  ) {
    throw new Error(
      "Invalid unconnected resources."
    );
  }

  const resourceMap = new Map(
    resources.map((resource) => [
      resource.id,
      resource,
    ])
  );

  const passageMap = new Map(
    passages.map((passage) => [
      passage.passage_id,
      passage,
    ])
  );

  const allowedRelationshipTypes = new Set([
    "reinforces",
    "complements",
    "contrasts",
    "applies",
    "extends",
  ]);

  const connections: Connection[] = [];

  for (const item of data.connections) {
    if (!isRecord(item)) {
      throw new Error(
        "Invalid connection structure."
      );
    }

    if (
      !isNonEmptyString(item.title) ||
      !isNonEmptyString(item.explanation) ||
      !isNonEmptyString(item.relationship_type) ||
      !allowedRelationshipTypes.has(
        item.relationship_type
      )
    ) {
      throw new Error(
        "Connection fields are invalid."
      );
    }

    if (
      !Array.isArray(item.resource_ids) ||
      item.resource_ids.length < 2 ||
      !item.resource_ids.every(
        (id) =>
          typeof id === "string" &&
          resourceMap.has(id)
      )
    ) {
      throw new Error(
        "A connection references invalid resources."
      );
    }

    const connectionResourceIds = [
      ...new Set(item.resource_ids as string[]),
    ];

    if (connectionResourceIds.length < 2) {
      throw new Error(
        "A connection must involve at least two resources."
      );
    }

    if (!Array.isArray(item.evidence)) {
      throw new Error(
        "Connection evidence is missing."
      );
    }

    const evidence: SourceEvidence[] = [];
    const usedPassages = new Set<string>();

    for (const entry of item.evidence) {
      if (
        !isRecord(entry) ||
        !isNonEmptyString(entry.resource_id) ||
        !isNonEmptyString(entry.passage_id)
      ) {
        throw new Error(
          "Invalid passage evidence structure."
        );
      }

      const passage = passageMap.get(
        entry.passage_id
      );

      if (
        !passage ||
        passage.resource_id !==
          entry.resource_id ||
        !connectionResourceIds.includes(
          entry.resource_id
        )
      ) {
        throw new Error(
          "Evidence references an invalid passage."
        );
      }

      if (usedPassages.has(entry.passage_id)) {
        continue;
      }

      usedPassages.add(entry.passage_id);

      evidence.push({
        resource_id: passage.resource_id,
        excerpt: passage.text,
      });
    }

    const evidenceResourceIds = new Set(
      evidence.map(
        (entry) => entry.resource_id
      )
    );

    if (
      !connectionResourceIds.every((id) =>
        evidenceResourceIds.has(id)
      )
    ) {
      throw new Error(
        "Every connected resource needs supporting evidence."
      );
    }

    connections.push({
      title: item.title.trim(),
      explanation: item.explanation.trim(),
      relationship_type:
        item.relationship_type,
      resource_ids: connectionResourceIds,
      evidence,
    });
  }

  const unconnectedResourceIds = [
    ...new Set(data.unconnected_resource_ids),
  ];

  if (
    !unconnectedResourceIds.every(
      (id) =>
        typeof id === "string" &&
        resourceMap.has(id)
    )
  ) {
    throw new Error(
      "Invalid unconnected resource IDs."
    );
  }

  const connectedIds = new Set(
    connections.flatMap(
      (connection) => connection.resource_ids
    )
  );

  if (
    unconnectedResourceIds.some((id) =>
      connectedIds.has(id)
    )
  ) {
    throw new Error(
      "A resource cannot be both connected and unconnected."
    );
  }

  const accountedForIds = new Set([
    ...connectedIds,
    ...(unconnectedResourceIds as string[]),
  ]);

  if (
    !resources.every((resource) =>
      accountedForIds.has(resource.id)
    )
  ) {
    throw new Error(
      "Connect response did not account for every selected resource."
    );
  }

  if (
    connections.length === 0 &&
    data.shared_themes.length > 0
  ) {
    throw new Error(
      "Shared themes cannot be reported without supported connections."
    );
  }

  return {
    summary: data.summary.trim(),
    shared_themes: data.shared_themes.map(
      (theme: string) => theme.trim()
    ),
    connections,
    unconnected_resource_ids:
      unconnectedResourceIds as string[],
  };
}

async function generateWithFallback(
  request: AIRequest
): Promise<AIResponse> {
  try {
    return await new GeminiProvider(
      PRIMARY_MODEL
    ).generate(request);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    if (
      !/Gemini API request failed \(503\)/.test(
        message
      )
    ) {
      throw error;
    }

    console.warn(
      `Primary model ${PRIMARY_MODEL} unavailable. ` +
        `Trying ${FALLBACK_MODEL}.`
    );

    return await new GeminiProvider(
      FALLBACK_MODEL
    ).generate(request);
  }
}

async function createFingerprint(
  resources: ResourceInput[],
  provider: string,
  model: string
): Promise<string> {
  const sorted = [...resources].sort(
    (a, b) => a.id.localeCompare(b.id)
  );

  const fingerprintInput = JSON.stringify({
    resources: sorted,
    prompt_version: CONNECT_PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    provider,
    model,
    temperature: 0.2,
    evidence_strategy: "passage-references-v1",
  });

  const bytes = new TextEncoder().encode(
    fingerprintInput
  );

  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

/**
 * Retrieve an existing result belonging to this user.
 * Used for caching and duplicate-insert recovery.
 */
async function findExistingConnection(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  fingerprints: string[]
): Promise<SavedConnection | null> {
  const { data, error } = await adminClient
    .from("ai_outputs")
    .select(
      "id, output_data, model_name, input_fingerprint"
    )
    .eq("user_id", userId)
    .eq("feature_type", "connection")
    .in("input_fingerprint", fingerprints)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "Connect cache lookup failed:",
      error
    );

    throw new Error(
      "Could not check existing connections."
    );
  }

  return data as SavedConnection | null;
}

function connectionResponse(
  saved: SavedConnection,
  resourceIds: string[]
): Response {
  return jsonResponse({
    success: true,
    output_id: saved.id,
    resource_ids: resourceIds,
    output: saved.output_data,
    model: saved.model_name,
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "Method not allowed.",
      405
    );
  }

  try {
    // 1. Authenticate the user.
    const authHeader = req.headers.get(
      "Authorization"
    );

    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(
        "UNAUTHORIZED",
        "Authentication required.",
        401
      );
    }

    const supabaseUrl = Deno.env.get(
      "SUPABASE_URL"
    );

    const anonKey = Deno.env.get(
      "SUPABASE_ANON_KEY"
    );

    const serviceRoleKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    );

    if (
      !supabaseUrl ||
      !anonKey ||
      !serviceRoleKey
    ) {
      return errorResponse(
        "SERVER_CONFIG_ERROR",
        "Server configuration is incomplete.",
        500
      );
    }

    const userClient = createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Invalid or expired session.",
        401
      );
    }

    // 2. Validate selected resource IDs.
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return errorResponse(
        "INVALID_JSON",
        "Request body must contain valid JSON.",
        400
      );
    }

    if (!isRecord(body)) {
      return errorResponse(
        "INVALID_REQUEST",
        "Request body must be a JSON object.",
        400
      );
    }

    const resourceIds = body.resource_ids;

    if (
      !Array.isArray(resourceIds) ||
      resourceIds.length < MIN_RESOURCES ||
      resourceIds.length > MAX_RESOURCES
    ) {
      return errorResponse(
        "INVALID_RESOURCE_COUNT",
        "Select between 2 and 5 resources.",
        400
      );
    }

    if (
      !resourceIds.every(
        (id) =>
          typeof id === "string" &&
          UUID_PATTERN.test(id)
      )
    ) {
      return errorResponse(
        "INVALID_RESOURCE_IDS",
        "Every resource must have a valid UUID.",
        400
      );
    }

    const uniqueIds = [
      ...new Set(
        (resourceIds as string[]).map(
          (id) => id.toLowerCase()
        )
      ),
    ];

    if (
      uniqueIds.length !== resourceIds.length
    ) {
      return errorResponse(
        "DUPLICATE_RESOURCES",
        "Each selected resource must be unique.",
        400
      );
    }

    // 3. Verify resource ownership.
    const {
      data: savedResources,
      error: resourceError,
    } = await userClient
      .from("resources")
      .select("id, title")
      .eq("user_id", user.id)
      .in("id", uniqueIds);

    if (
      resourceError ||
      !savedResources ||
      savedResources.length !== uniqueIds.length
    ) {
      return errorResponse(
        "RESOURCE_NOT_FOUND",
        "One or more selected resources were not found.",
        404
      );
    }

    // 4. Fetch source content.
    const resources: ResourceInput[] = [];

    for (const id of uniqueIds) {
      const resource = savedResources.find(
        (item) => item.id === id
      );

      if (!resource) {
        return errorResponse(
          "RESOURCE_NOT_FOUND",
          "A selected resource could not be found.",
          404
        );
      }

      const {
        data: savedContent,
        error: contentError,
      } = await userClient
        .from("resource_contents")
        .select("content_text")
        .eq("resource_id", id)
        .eq("user_id", user.id)
        .order("content_version", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (
        contentError ||
        !savedContent?.content_text?.trim()
      ) {
        return errorResponse(
          "CONTENT_NOT_FOUND",
          `No usable content found for "${resource.title}".`,
          400
        );
      }

      resources.push({
        id,
        title: resource.title,
        content: savedContent.content_text
          .trim()
          .slice(0, MAX_CONTENT_CHARS),
      });
    }

    // 5. Prepare passage-based AI input.
    const passages = resources.flatMap(
      splitIntoPassages
    );

    const resourcePayload = resources.map(
      (resource) => ({
        resource_id: resource.id,
        title: resource.title,
        passages: passages
          .filter(
            (passage) =>
              passage.resource_id === resource.id
          )
          .map((passage) => ({
            passage_id: passage.passage_id,
            text: passage.text,
          })),
      })
    );

    const aiRequest: AIRequest = {
      messages: [
        {
          role: "system",
          content: CONNECT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content:
            "Find meaningful conceptual connections " +
            "between these saved learning resources. " +
            "Use the provided passage IDs for evidence:\n\n" +
            JSON.stringify(
              resourcePayload,
              null,
              2
            ),
        },
      ],
      temperature: 0.2,
      maxTokens: 8000,
    };

    // 6. Initialize server-side database client.
    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // 7. Check for previously generated results.
    // Use the provider name stored by GeminiProvider.
    const providerName = "gemini";

    const primaryFingerprint =
      await createFingerprint(
        resources,
        providerName,
        PRIMARY_MODEL
      );

    const fallbackFingerprint =
      await createFingerprint(
        resources,
        providerName,
        FALLBACK_MODEL
      );

    const existingOutput =
      await findExistingConnection(
        adminClient,
        user.id,
        [
          primaryFingerprint,
          fallbackFingerprint,
        ]
      );

    if (existingOutput) {
      console.log(
        "Reusing existing Connect output:",
        existingOutput.id
      );

      return connectionResponse(
        existingOutput,
        uniqueIds
      );
    }

    // 8. Generate and validate.
    const aiResponse =
      await generateWithFallback(aiRequest);

    let parsedOutput: unknown;

    try {
      parsedOutput = JSON.parse(
        aiResponse.text
      );
    } catch {
      throw new Error(
        "Gemini returned invalid JSON for Connect."
      );
    }

    const connectionOutput =
      validateConnectionOutput(
        parsedOutput,
        resources,
        passages
      );

    // 9. Fingerprint using the actual model.
    const fingerprint =
      await createFingerprint(
        resources,
        aiResponse.provider,
        aiResponse.model
      );

    // 10. Save output.
    const {
      data: savedOutput,
      error: saveError,
    } = await adminClient
      .from("ai_outputs")
      .insert({
        user_id: user.id,
        feature_type: "connection",
        output_data: connectionOutput,
        input_fingerprint: fingerprint,
        model_provider: aiResponse.provider,
        model_name: aiResponse.model,
        prompt_version:
          CONNECT_PROMPT_VERSION,
        output_schema_version:
          SCHEMA_VERSION,
      })
      .select("id")
      .single();

    // Handle duplicate requests safely.
    if (saveError?.code === "23505") {
      console.log(
        "Duplicate Connect fingerprint detected."
      );

      const existing =
        await findExistingConnection(
          adminClient,
          user.id,
          [fingerprint]
        );

      if (existing) {
        return connectionResponse(
          existing,
          uniqueIds
        );
      }
    }

    if (
      saveError ||
      !savedOutput
    ) {
      console.error(
        "Connect output save failed:",
        saveError
      );

      throw new Error(
        "Could not save the generated connections."
      );
    }

    // 11. Link all selected resources.
    const links = uniqueIds.map(
      (resourceId) => ({
        output_id: savedOutput.id,
        resource_id: resourceId,
        user_id: user.id,
      })
    );

    const {
      error: linkError,
    } = await adminClient
      .from("ai_output_resources")
      .insert(links);

    if (linkError) {
      console.error(
        "Connect resource linking failed:",
        linkError
      );

      const {
        error: cleanupError,
      } = await adminClient
        .from("ai_outputs")
        .delete()
        .eq("id", savedOutput.id)
        .eq("user_id", user.id);

      if (cleanupError) {
        console.error(
          "Connect cleanup failed:",
          cleanupError
        );
      }

      throw new Error(
        "Could not link connections to the selected resources."
      );
    }

    // 12. Return unchanged frontend format.
    return jsonResponse({
      success: true,
      output_id: savedOutput.id,
      resource_ids: uniqueIds,
      output: connectionOutput,
      model: aiResponse.model,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Connection generation failed.";

    console.error(
      "Connect generation failed:",
      message
    );

    return errorResponse(
      "CONNECTION_GENERATION_FAILED",
      message,
      500
    );
  }
});
