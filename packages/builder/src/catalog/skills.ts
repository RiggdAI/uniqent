export interface SkillCatalogEntry {
  name: string;
  description: string;
  skillMd: string;
}

/** Curated, contributable set of starter skills. */
export const SKILL_CATALOG: SkillCatalogEntry[] = [
  {
    name: 'code-review',
    description: 'Review code changes for correctness, clarity, and obvious bugs.',
    skillMd: [
      '---',
      'name: code-review',
      'description: Review code changes for correctness, clarity, and obvious bugs.',
      '---',
      '',
      '# Code Review',
      '',
      'When reviewing a change: read the diff, identify correctness bugs first, then',
      'flag unclear naming and missing tests. Be specific and cite line references.',
      '',
    ].join('\n'),
  },
  {
    name: 'summarize',
    description: 'Produce a concise, faithful summary of a document or thread.',
    skillMd: [
      '---',
      'name: summarize',
      'description: Produce a concise, faithful summary of a document or thread.',
      '---',
      '',
      '# Summarize',
      '',
      'Capture the key points, decisions, and open questions. Prefer bullet points.',
      'Never invent facts not present in the source.',
      '',
    ].join('\n'),
  },
];
