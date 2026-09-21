import { chemistrySeed } from "./chemistry.js";
import { mathematicsSeed } from "./mathematics.js";

export interface TaxonomySeedTag {
  slug: string;
  label: string;
  // Omitted for a root tag. Order within `tags` matters: a parent must appear
  // before its children, since seeding inserts in order and createTag rejects
  // an unknown parent.
  parent_slug?: string;
}

export interface TaxonomySeed {
  // Root slug of the subject tree this seed fills in.
  subject: string;
  label: string;
  tags: TaxonomySeedTag[];
}

// Subject root slug -> seed. A subject with no entry here is simply not
// seedable; bootstrap reports seed_available: false and the caller mints tags
// by hand as before.
export const TAXONOMY_SEEDS: Record<string, TaxonomySeed> = {
  [chemistrySeed.subject]: chemistrySeed,
  [mathematicsSeed.subject]: mathematicsSeed,
};

// A seed is keyed by the ROOT segment, so bootstrap("chemistry:gases") finds
// the chemistry seed — same resolution rule bootstrap's graph-DSL gate uses.
export function seedForSubject(subject: string | null): TaxonomySeed | undefined {
  if (!subject) return undefined;
  return TAXONOMY_SEEDS[subject.split(":")[0]];
}
