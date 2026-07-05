export interface SkillCatalogEntry {
  name: string;
  description: string;
  skillMd: string;
}

/**
 * Skills are bespoke per agent, so there is intentionally no baked-in skill catalog.
 * Bring your own: author a custom SKILL.md, upload one, or import from a URL.
 */
export const SKILL_CATALOG: SkillCatalogEntry[] = [];
