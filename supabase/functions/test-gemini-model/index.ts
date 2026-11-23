
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:5174",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders },
    );
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");

  if (!apiKey) {
    return Response.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 500, headers: corsHeaders },
    );
  }

  try {
    const response = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: 'Return exactly this JSON: {"status":"working"}',
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 200,
      },
    }),
  },
);

   const data = await response.json();

return Response.json(
  {
    model: "gemini-3.1-flash-lite",
    status: response.status,
    success: response.ok,
    result: response.ok
      ? data.candidates?.[0]?.content?.parts?.[0]?.text ?? null
      : data.error?.message ?? "Unknown Gemini error",
  },
  { headers: corsHeaders },
);
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500, headers: corsHeaders },
    );
  }
});
