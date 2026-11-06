# Build The Dev Daily

Implement a working local-network web app called **The Dev Daily** for What Up Games. It turns AI-written Markdown briefings into a cute newspaper that I can read in a desktop browser or on my phone while connected to my home network.

Read this prompt, `EDITION_TEMPLATE.md`, the complete sample in `examples/editions/`, and the approved prototype `design/sunday-comics.html` before implementing. Open the prototype and click through the homepage, phone layout, article view, and archive. `design/reference.jpg` is the original visual concept. The approved HTML takes precedence wherever they differ.

## Build and run

- Inspect the existing project first and reuse its stack and conventions if there is one. For an empty project, pick a small server-rendered stack you can run and test locally. Use a mature Markdown parser and a safe YAML parser. Keep the content folder as the source of truth. A database and CMS are unnecessary for v1.
- Implement the app, run it, and document the exact setup and launch commands. Include PowerShell examples for running it and publishing an edition. Make the content directory, bind address, and port configurable. Show how to run it on localhost first, then how to make it available on my home LAN with the firewall scoped to the local subnet. Do not expose it through public hosting, port forwarding, or a public tunnel.
- Serve UI assets locally at runtime. The prototype uses an external font URL for the mockup. Bundle a properly licensed local font or use a close local fallback. No CDN dependency is needed to read the paper.
- Read editions on request or refresh a local index automatically. A valid new file should show up on browser refresh without an app rebuild, manual import, or server restart. The AI that researches and writes the briefing is a separate process. It needs write access to the content folder, and the web app only needs read access.

## Approved design

- Use **Sunday Comics**. Match the warm paper grain, large heavy serif masthead, illustrated controller, purple creator-tools stamp, ink rules, rough purple section ribbons, and coffee-and-books illustration. Reuse the embedded artwork and useful styles from the prototype. Keep text black on paper and light lavender. White text is reserved for dark purple fills.
- Desktop front page has a narrow **In this edition** rail and a main spread. Put the torn-paper lead image on the left and the headline, summary, tags, and **Read More** on the right. Put up to two secondary story cards side by side beneath it. Keep the compact **Roundup at a Glance** index below the cards. It can link to the same stories and should make any remaining stories discoverable.
- On phones, stack the lead image above its headline and the cards in one column. Replace the desktop rail with a collapsible **Table of Contents**. Use actual responsive breakpoints. The prototype's Phone view toggle is a preview aid.
- Article pages read straight through in one column. Show the section, headline, date, availability, image and credit when present, summary, tags, and all body sections as visible subheadings and paragraphs. Keep **Back to edition** tied to the issue the reader came from. Article sections are always expanded.
- Keep the masthead date and edition number, a clear **All Editions** entry point, and a date-sorted archive with the newest issue first. Style archive rows like the reference. Keep keyboard focus visible and use real links for navigable pages.

## Content and behavior

- Discover real calendar-date filenames matching `YYYY-MM-DD.md` directly under the configured editions folder. The YAML frontmatter contains `title`, `edition_date`, `coverage_start`, and `coverage_end`. Require the edition date to match the filename and the coverage range to be ordered. Use the dates as calendar dates so rendering cannot shift them by timezone.
- The template is the contract. One H1 is the issue heading, each H2 starts a story, and H3 headings are article sections rendered in order. The labeled story fields are `Section`, `Featured`, `News date`, `Availability`, `Tags`, and `Summary`. Read field lines even when Markdown parses consecutive lines as one paragraph. Support a summary that wraps across lines. Parse headings structurally so a heading inside a code fence cannot split a story.
- One featured story is the editorial target. Use the first marked story if multiple are marked, or the first story if none is marked. Keep the remaining stories in file order. Build the TOC and any section counts from actual stories. Only show sections that have content. A category link should jump to the relevant stories in that issue.
- Serve the newest valid issue at the home URL. Give every issue and article a stable, direct URL, including when opened from the archive. Use dates for issue identity and handle duplicate story slugs deterministically. Display edition numbers derived from dates in archive order. Keep URLs independent of those display numbers. Archive entries come from actual files.
- Resolve relative images from their issue file, using `editions/images/YYYY-MM-DD/` as the default convention. Preserve alt text and source credit. Keep the layout intact for missing images, missing optional sections, one-story issues, and long headlines. If an issue is unreadable or invalid, report the filename clearly and keep the other issues readable. Provide a friendly empty state and a missing-issue or missing-story page.
- Treat AI-generated Markdown as content. Disable raw HTML or sanitize rendered HTML, validate link and image URL schemes, and restrict image serving to the configured image tree, including after path and symlink resolution. The server should only expose the intended content and assets. Document writing the finished issue to a temporary file and renaming it into place after its images are ready.
- The bundled November 6 issue is sample content based on the briefing supplied during design. Use it for development and keep its illustrative article images separate from the concept crops in the prototype.

## Acceptance checks

1. Launch with the bundled sample. Check the lead, secondary cards, roundup, tags, date, and story links.
2. Add a second valid dated issue while the app is running. Refresh to see the latest issue and both archive entries. Open the older issue, follow an article link, reload that URL, and return to the correct issue.
3. Check desktop and phone widths, including 320px. Verify no horizontal clipping, the mobile TOC, and fully visible article sections. Check a long headline and a missing image.
4. Verify a malformed issue leaves valid issues readable and that unsafe Markdown and image paths cannot execute script or expose arbitrary files.
5. Run the relevant checks and report what passed, the exact startup command, and the directory where my briefing AI should write new issues. If this environment cannot reach my home LAN, give me the phone verification steps.

Build the working app and its tests and run instructions. Ask only if a missing decision blocks implementation.
