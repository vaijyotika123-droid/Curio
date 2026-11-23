
export type ResourceOverview = {
  quickOverview: string;
  detailedSummary: string;
  keyTakeaways: string[];
  evidence: {
    claim: string;
    sourceExcerpt: string;
  }[];
};

export function validateResourceOverview(
  data: unknown
): ResourceOverview {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid resource overview.");
  }

  const result = data as Record<string, unknown>;

  if (
    typeof result.quickOverview !== "string" ||
    typeof result.detailedSummary !== "string" ||
    !Array.isArray(result.keyTakeaways) ||
    !Array.isArray(result.evidence)
  ) {
    throw new Error("Resource overview has an invalid structure.");
  }

  if (
    !result.quickOverview.trim() ||
    !result.detailedSummary.trim()
  ) {
    throw new Error("Overview and summary cannot be empty.");
  }

  if (
    !result.keyTakeaways.every(
      (item) => typeof item === "string" && item.trim().length > 0
    )
  ) {
    throw new Error("Invalid key takeaways.");
  }

  if (
    !result.evidence.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.claim === "string" &&
        typeof item.sourceExcerpt === "string" &&
        item.claim.trim().length > 0 &&
        item.sourceExcerpt.trim().length > 0
    )
  ) {
    throw new Error("Invalid evidence references.");
  }

  return result as ResourceOverview;
}
