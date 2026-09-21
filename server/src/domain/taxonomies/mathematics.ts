import type { TaxonomySeed } from "./index.js";

// Deliberately small: the four AMC/AIME subject areas, under the "math" root
// slug the bank already uses everywhere (draw tests, daily-draw hierarchy
// tests, readme's own "math:functions:quadratic" example). A second root
// spelled "mathematics" would be a near-duplicate of a live slug, so this
// file's name is the only place the long spelling appears.
export const mathematicsSeed: TaxonomySeed = {
  subject: "math",
  label: "Mathematics",
  tags: [
    { slug: "math", label: "Mathematics" },
    { slug: "math:algebra", label: "Algebra", parent_slug: "math" },
    { slug: "math:geometry", label: "Geometry", parent_slug: "math" },
    { slug: "math:number_theory", label: "Number Theory", parent_slug: "math" },
    { slug: "math:counting_probability", label: "Counting and Probability", parent_slug: "math" },
  ],
};
