// Copy this file when adding a new source adapter.
// The adapter must return videos with the unified fields below:
// id, title, thumbnail, duration, sourceUrl, playUrl, publishedAt, actors, tags, sourceName.

export function createSourceTemplateAdapter() {
  return {
    key: "template",
    sourceName: "template",
    displayName: "Template Source",
    enabled: false,
    createContext() {
      return {};
    },
    async crawlLatest() {
      return emptyResult("template_disabled");
    },
    async crawlBackfill() {
      return emptyResult("template_disabled");
    }
  };
}

function emptyResult(stopReason) {
  return {
    sourceName: "template",
    items: [],
    sourceItems: [],
    pagesDone: 0,
    fetchedCount: 0,
    duplicateCount: 0,
    listFoundCount: 0,
    existingCount: 0,
    candidateCount: 0,
    parsedCount: 0,
    parseFailureCount: 0,
    nextCursor: "",
    nextPage: 0,
    hasMore: false,
    stopReason
  };
}
