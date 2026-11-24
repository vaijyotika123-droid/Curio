
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

// Match quotations against the original source while allowing
// harmless whitespace differences. Return the original source text.
function findVerifiedExcerpt(
  excerpt: string,
  content: string
): string | null {
  if (!excerpt.trim()) {
    return null;
  }

  const exactIndex = content.indexOf(excerpt);

  if (exactIndex !== -1) {
    return content.slice(
      exactIndex,
      exactIndex + excerpt.length
    );
  }

  const normalizedExcerpt = excerpt
    .trim()
    .replace(/\s+/g, " ");

  const normalizedContent = content.replace(/\s+/g, " ");

  const normalizedIndex =
    normalizedContent.indexOf(normalizedExcerpt);

  if (normalizedIndex === -1) {
    return null;
  }

  // Recover the original source substring, preserving its formatting.
  const sourceCharacters: number[] = [];
  let previousWasWhitespace = false;

  for (let i = 0; i < content.length; i++) {
    const character = content[i];
    const isWhitespace = /\s/.test(character);

    if (isWhitespace) {
      if (!previousWasWhitespace) {
        sourceCharacters.push(i);
      }
    } else {
      sourceCharacters.push(i);
    }

    previousWasWhitespace = isWhitespace;
  }

  const start = sourceCharacters[normalizedIndex];
  const endPosition =
    normalizedIndex + normalizedExcerpt.length - 1;
  const end = sourceCharacters[endPosition];

  if (start === undefined || end === undefined) {
    return null;
  }

  return content.slice(start, end + 1);
}

function verifyEvidence(
  overview: ResourceOverview,
  content: string
): {
  overview: ResourceOverview;
  invalidEvidence: string[];
} {
  const validEvidence: ResourceOverview["evidence"] = [];
  const invalidEvidence: string[] = [];

  for (const item of overview.evidence) {
    const verifiedExcerpt = findVerifiedExcerpt(
      item.sourceExcerpt,
      content
    );

    if (verifiedExcerpt === null) {
      invalidEvidence.push(item.sourceExcerpt);
      continue;
    }

    validEvidence.push({
      ...item,
      sourceExcerpt: verifiedExcerpt,
    });
  }

  return {
    overview: {
      ...overview,
      evidence: validEvidence,
    },
    invalidEvidence,
  };
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

  // Generate the initial AI overview.
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

  const generatedOverview =
    parseAndValidateOverview(response.text);

  const initialVerification = verifyEvidence(
    generatedOverview,
    content
  );

  if (initialVerification.invalidEvidence.length === 0) {
    return {
      overview: initialVerification.overview,
      provider: response.provider,
      model: response.model,
    };
  }

  console.warn(
    "AI evidence verification failed. Attempting correction.",
    {
      invalidExcerptCount:
        initialVerification.invalidEvidence.length,
    }
  );

  // Ask Gemini to correct quotations that could not be verified.
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
match the original resource.

Previous response:
${JSON.stringify(generatedOverview)}

Invalid excerpts:
${JSON.stringify(initialVerification.invalidEvidence)}

CORRECTION INSTRUCTIONS:
- Preserve the original overview, summary, and takeaways
  unless a correction is necessary for factual accuracy.
- Replace invalid sourceExcerpt values with exact,
  contiguous quotations copied from the resource.
- Do not paraphrase or invent quotations.
- If a claim has no verifiable excerpt, remove that
  evidence item.
- Return the complete corrected JSON object.
- Return valid JSON only.`,
      },
    ],
    temperature: 0.1,
    maxTokens: 6000,
  });

  const correctedOverview =
    parseAndValidateOverview(correctionResponse.text);

  const correctedVerification = verifyEvidence(
    correctedOverview,
    content
  );

  if (correctedVerification.invalidEvidence.length > 0) {
    console.warn(
      "Removing unverified evidence excerpts after correction.",
      {
        removedCount:
          correctedVerification.invalidEvidence.length,
      }
    );
  } else {
    console.log("AI evidence correction succeeded.");
  }

  return {
    overview: correctedVerification.overview,
    provider: correctionResponse.provider,
    model: correctionResponse.model,
  };
}
