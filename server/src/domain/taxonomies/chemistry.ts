import type { TaxonomySeed } from "./index.js";

// Ebbing & Gammon, *General Chemistry* 11e, chapters 1-12 — the book this
// bank's chemistry material is written against. Slugs are the short handle;
// labels are the chapter titles, so a tag listing reads as a table of
// contents rather than as a set of guesses about what a slug meant.
//
// The tech: tags ride along with this seed because they are what a chemistry
// item actually needs at render time: mhchem for formula/equation markup,
// calculator for arithmetic-heavy stoichiometry and gas-law work. They are
// not under the subject root (kind "tech" is deliberately cross-subject), so
// they do not count toward the subject's tag_count.
export const chemistrySeed: TaxonomySeed = {
  subject: "chemistry",
  label: "Chemistry",
  tags: [
    { slug: "chemistry", label: "Chemistry" },
    { slug: "chemistry:matter_and_measurement", label: "Chemistry and Measurement", parent_slug: "chemistry" },
    { slug: "chemistry:atoms_molecules_ions", label: "Atoms, Molecules, and Ions", parent_slug: "chemistry" },
    {
      slug: "chemistry:stoichiometry",
      label: "Calculations with Chemical Formulas and Equations",
      parent_slug: "chemistry",
    },
    { slug: "chemistry:reactions_in_solution", label: "Chemical Reactions", parent_slug: "chemistry" },
    { slug: "chemistry:gases", label: "The Gaseous State", parent_slug: "chemistry" },
    { slug: "chemistry:thermochemistry", label: "Thermochemistry", parent_slug: "chemistry" },
    { slug: "chemistry:quantum_theory", label: "Quantum Theory of the Atom", parent_slug: "chemistry" },
    {
      slug: "chemistry:electron_configurations",
      label: "Electron Configurations and Periodicity",
      parent_slug: "chemistry",
    },
    { slug: "chemistry:ionic_covalent_bonding", label: "Ionic and Covalent Bonding", parent_slug: "chemistry" },
    {
      slug: "chemistry:molecular_geometry",
      label: "Molecular Geometry and Chemical Bonding Theory",
      parent_slug: "chemistry",
    },
    { slug: "chemistry:liquids_solids", label: "States of Matter; Liquids and Solids", parent_slug: "chemistry" },
    { slug: "chemistry:solutions", label: "Solutions", parent_slug: "chemistry" },
    { slug: "tech:mhchem", label: "Needs mhchem formula markup" },
    { slug: "tech:calculator", label: "Needs a calculator" },
  ],
};
