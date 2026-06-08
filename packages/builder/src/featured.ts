/** A brain promoted in `uniqent try` and (later) Studio's gallery. */
export interface FeaturedBrain {
  /** Slug — also the example source dir and the featured `.uniqent` filename. */
  name: string;
  displayName: string;
  /** One-line pitch shown in `try --list`. */
  pitch: string;
  /** Demo prompts shown after install. */
  suggestedPrompts: string[];
}

export const FEATURED_BRAINS: FeaturedBrain[] = [
  {
    name: 'research-analyst',
    displayName: 'Research Analyst',
    pitch: 'Fetches primary sources and writes faithful, fully-cited summaries. No API key needed.',
    suggestedPrompts: [
      'Research the best vector database for a RAG app and cite every claim.',
      'Summarize the current state of small open-weight LLMs, with sources.',
    ],
  },
];

export function featuredBrains(): FeaturedBrain[] {
  return FEATURED_BRAINS;
}

export function findFeatured(name: string): FeaturedBrain | undefined {
  return FEATURED_BRAINS.find((b) => b.name === name);
}
