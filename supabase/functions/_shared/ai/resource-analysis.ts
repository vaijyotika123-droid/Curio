
import type { AIProvider } from "./provider.ts";
import { RESOURCE_OVERVIEW_PROMPT } from "./prompts.ts";
import {
  validateResourceOverview,
  type ResourceOverview,
} from "./schemas.ts";

export type ResourceAnalysisResult = {
  overview: ResourceOverview;
  provider: string;
  model: string;
};

function parseAndValidateOverview(text: string): ResourceOverview {
  let parsedResponse: unknown;

  try {
    parsedResponse = JSON.parse(text);
  } catch {
    throw new Error("AI returned an invalid JSON response.");
  }

  return validateResourceOverview(parsedResponse);
}

function getInvalidEvidence(
  overview: ResourceOverview,
  content: string
): string[] {
  return overview.evidence
    .filter((item) => !content.includes(item.sourceExcerpt))
    .map((item) => item.sourceExcerpt);
}

export async function analyzeResource(
  provider: AIProvider,
  title: string,
  content: string
): Promise<ResourceAnalysisResult> {
  if (!content.trim()) {
    throw new Error("Resource content cannot be empty.");
  }

  const resourceMessage = `Analyse the following resource.

Title: ${title}

Resource content:
${content}`;

  // First attempt: generate the complete overview.
  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content: RESOURCE_OVERVIEW_PROMPT,
      },
      {
        role: "user",
        content: resourceMessage,
      },
    ],
    temperature: 0.2,
    maxTokens: 6000,
  });

  let overview = parseAndValidateOverview(response.text);
  let invalidEvidence = getInvalidEvidence(overview, content);

  if (invalidEvidence.length === 0) {
    return {
      overview,
      provider: response.provider,
      model: response.model,
    };
  }

  console.warn("AI evidence verification failed. Attempting correction.", {
    invalidExcerptCount: invalidEvidence.length,
  });

  // Second attempt: ask Gemini to correct the invalid quotations.
  const correctionResponse = await provider.generate({
    messages: [
      {
        role: "system",
        content: RESOURCE_OVERVIEW_PROMPT,
      },
      {
        role: "user",
        content: `${resourceMessage}

Your previous response contained evidence excerpts that did not
match the original resource character for character.

Previous response:
${JSON.stringify(overview)}

Invalid excerpts:
${JSON.stringify(invalidEvidence)}

CORRECTION INSTRUCTIONS:
- Preserve the original overview, summary, and takeaways
  unless a correction is necessary for factual accuracy.
- Replace invalid sourceExcerpt values with exact,
  contiguous quotations copied from the resource.
- Do not paraphrase, normalize, shorten with ellipses,
  or change punctuation inside quotations.
- If a claim has no verifiable excerpt, remove that
  evidence item.
- Return the complete corrected JSON object.
- Return valid JSON only.`,
      },
    ],
    temperature: 0.1,
    maxTokens: 6000,
  });

  overview = parseAndValidateOverview(correctionResponse.text);
  invalidEvidence = getInvalidEvidence(overview, content);

  if (invalidEvidence.length > 0) {
    throw new Error(
      "AI evidence verification failed after one correction attempt."
    );
  }

  console.log("AI evidence correction succeeded.");

  return {
    overview,
    provider: correctionResponse.provider,
    model: correctionResponse.model,
  };
}
