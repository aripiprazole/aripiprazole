# Hand-Written Static HTML Refactor

## Goal

Refactor the static portfolio under `public/` so its source reads as deliberate,
hand-written HTML and CSS while preserving the current rendered identity.

## Constraints

- Preserve the existing text, links, images, project ordering, and social links.
- Preserve the permanent light theme, monospace typography, sidebar/content
  layout, and responsive behavior.
- Keep the site fully static with no JavaScript or framework runtime artifacts.
- Avoid a visual redesign. Small rendering differences are acceptable only when
  they result from removing dead markup or correcting invalid semantics.

## HTML

`public/index.html` becomes a conventional semantic document built from:

- a profile sidebar containing the portrait and related GitHub accounts;
- a primary content column containing the introduction, projects, writing, and
  social links;
- meaningful `header`, `main`, `aside`, `section`, `article`, `nav`, and
  `footer` elements;
- short, descriptive class names such as `site-layout`, `profile`,
  `project-list`, `project`, and `social-links`.

Empty popovers, exported component wrappers, generated inline measurements,
duplicated icon markup, and hashed CSS-module class names are removed. External
links retain accessible labels and use a single small external-link treatment
instead of repeated exported SVG trees.

## CSS

The two generated stylesheets are replaced by `public/styles.css`. The new
stylesheet contains:

- a small set of named color and spacing custom properties;
- base typography and focus styles;
- layout rules grouped by page region;
- one shared article-row pattern for projects and writing;
- responsive rules for the existing desktop, tablet, and mobile layouts;
- no selectors for removed popovers, themes, framework wrappers, or unused
  components.

The current visual values are retained wherever practical. CSS names and
grouping describe intent rather than their former component origin.

## Verification

The refactor is complete when:

- the page contains no scripts, event attributes, Next.js markers, hashed class
  names, empty structural elements, or references to the old stylesheets;
- every local image and stylesheet reference exists;
- HTML nesting and CSS delimiter checks pass;
- the page serves successfully from `public/`;
- desktop and mobile screenshots preserve the current visual hierarchy;
- `git diff --check` reports no whitespace errors.
