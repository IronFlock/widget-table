# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run start` — Vite dev server on port 8000 with `--watch` rebuild, opens `/demo/`.
- `npm run build` — Production library build (ES module) to `dist/`.
- `npm run watch` — Build only, watch mode.
- `npm run types` — Regenerate `src/definition-schema.d.ts` from `src/definition-schema.json` via `json2ts` (run after editing the schema).
- `just lint` — what the CI gate checks besides the build: regenerating the committed generated files (`npm run types`) changes nothing. `just build` = `npm run build`.
- `just merge` / `just release-patch` (`release-minor`, `release-major`) — pull requests into `main` from a feature branch with everything committed: a no-release one, or a release one whose merge publishes to npm in CI (`.github/workflows/build-publish.yml`), then the release GitHub App tags the bare version and creates the GitHub release. Never `npm publish`, tag or edit the version by hand.
- `npm run link` / `npm run unlink` — Link/unlink against sibling `../RESWARM/frontend` for local integration.

No test framework or linter is configured. Node `>=24.9.0`, npm `>=10.0.2`.

## Architecture

Single-file Lit 3 web component (`src/widget-table.ts`) wrapping `@vaadin/grid` (peer dependency, externalized in the bundle), with `@material/web`'s icon button for edit columns (peer dependency, externalized too: Studio's import map provides both and loads the Material Symbols font `md-icon` draws with). The component is registered as `widget-table-versionplaceholder`; the Vite build replaces `versionplaceholder` with the package version via `@rollup/plugin-replace`, so the live tag is e.g. `widget-table-1.1.17`. Consumers must use the version-suffixed tag matching the installed package — this lets multiple widget versions coexist on one page in the IronFlock dashboard.

Build pipeline (`vite.config.ts`):
- Library mode, ES-only output, entry `src/widget-table.ts` → `dist/widget-table.js`.
- Externalizes `lit*`, `@lit*`, `@vaadin*` and `@material/web` so consumers provide them.
- `tslib` aliased to `tslib/tslib.es6.js`; `process.env.NODE_ENV` defined to `"production"`.

### IronFlock platform contract

The widget exposes two reactive properties consumed by the host dashboard (it needs no `route`: it never reads the URL, only asks Studio to change it):
- `inputData: TableConfiguration` — typed by `src/definition-schema.d.ts`, generated from `src/definition-schema.json`. The JSON schema is the source of truth for both the runtime type and the dashboard's config UI (note the non-standard `order`, `dataDrivenDisabled`, `condition.showIfValueIn`, and `color: true` keys consumed by the IronFlock config editor).
- `theme: { theme_name, theme_object }` — ECharts-style theme object. `registerTheme()` resolves colors with this precedence: CSS custom properties (`--re-text-color`, `--re-hover-color`, `--re-border-color`) on the host element override `theme_object` values. These are not snapshotted: `registerTheme()` stores a `var(--re-…, <theme value>)` chain, so a change to the host property repaints the tile live without the widget being told. The grid paints no background of its own (`--grid-bg-color` stays unset): studio's `widget-item` already paints `--re-tile-background-color` on the tile, and painting it again here composited a translucent tile colour twice, and the grid, its rows and its cells each painting it stacked it several times. Only the sticky header is opaque: `headerSurfaceColor()` composites the tile as displayed (`--re-tile-background-color` over `--re-background-color` over white, read at render time, cached by `opaqueSurface()`), so rows scrolling under it stay hidden.

The widget acts on the platform only through two events dispatched on itself (`bubbles: true, composed: true`): `param-submit` `{ params: { [key]: value } }` from an edit column's button (Studio merges the parameter into the page URL, hands every widget the new `route` and re-queries bindings whose filter uses it), and `nav-submit` `{ path }` from a `button` or `image` link to a board page. Nothing handles them in the Widget Editor's preview or the AI chat.

### Data shape and rendering

`inputData.columns` is column-oriented (each column carries its own `values[]`, bound separately in Studio, so rows line up by position only and a row has no identity of its own). `transformInputData()` pivots columns into row records keyed `col_<index>` for Vaadin Grid, in the order the data arrives (oldest first, as Studio delivers it), kept as `unsortedRows`; `rows` is that list in the active sort.

Sorting is the widget's, not vaadin's: every column is a plain `vaadin-grid-column`, `sortRows()` orders the rows before the grid gets them, and `headerRenderer()` draws the header. Vaadin's sort column was dropped because it ranks sorted columns by the order they were sorted in (column order on first render), so a configured priority could neither be applied nor numbered in the headers, and because it compares the raw strings (`'100'` before `'20'`). The configured sort is `columns[].sortDirection` (`'none'` exists because Studio's enum select has no empty option) plus an optional `sortPriority`; `configuredSort()` orders keys by priority (missing, empty or below 1 counts as last), then column index, and checks the type itself, since Studio passes a stale direction on an image or edit column whose condition hides it. `sortValueReader()` parses cells the way they display (shared `parseNumber`, `toDate`, `isTrueValue`; a state's rank comes from `parseStatePairs()`, because an object reorders integer-like keys); empty or unparseable cells sort last in both directions and ties keep arrival order. A header click sets `viewerSort` to that column alone (asc, desc, then back to the configured sort; a choice equal to the configured sort clears it). It survives data updates and is reset when `JSON.stringify(configuredSort())` changes. A sortable header is a `<button>` that is the header content's first element: vaadin's Space on a header cell clicks that element and Enter focuses the `focus-target`. The indicator is vaadin's two-triangle glyph as inline SVG (no icon font needed), in `currentColor`: faint while unsorted, full strength when sorted.

Cell rendering dispatches on `column.type` in `renderCell()`: `string`, `number` (with `precision`), `boolean`, `state` (parses `stateMap` string `"'ONLINE': 'green', ..."` into a colored `.statusbox`), `button`, `image`, `timestamp`, `edit`.

Links (`renderLink()`, for `button` and `image`): a link with a scheme or `//` is a web address and opens in a new tab (`rel="noopener noreferrer"`); anything else is a board page and dispatches `nav-submit`, from a real `<button>` rather than an anchor with a relative `href`, which a middle-click would open against Studio's origin. An empty link leaves the content unlinked.

Edit column (`renderEditButton()`): the cell's value is the record key, sent as `param-submit` under `styling.parameterKey` (`parameterValue()` turns text, numbers and booleans into text and refuses objects); a blank key renders the button disabled with the reason as the wrapper's `title` (a disabled Material button has `pointer-events: none`, so its own title never shows). Decisions that came out of reading vaadin and Material: the column is not sortable (sorting by the key means nothing), and its header is centred by the `.cell.cell-center` div of `headerRenderer()` (cell content is a flex container, so vaadin's `textAlign` alone does not centre a bare header); vaadin's focus utils do not count `md-icon-button` as focusable, so the button carries `focus-target` (Enter in the cell focuses it) and the click sets `skipCellActivate` so the row's active item does not toggle; the button is sized in `em` and coloured with `currentColor` tokens (Material's 40px default would make the rows taller, and `currentColor` inside its shadow DOM resolves to the `.cell` colour chain); the default width is `calc(2 * var(--cell-padding-horizontal) + 2.5em)`. `default-data.json` has no edit column: it seeds every new tile and the AI's example, and an edit column only makes sense next to a form or a filtered widget. The demo adds one. Timestamps use a hand-rolled Unicode LDML subset (`yyyy MM dd HH mm ss SSS`) — see `parseTimestamp` / `formatTimestamp`. `parseTimestamp` maps capture groups to tokens by their position in the format and applies the setters year, month, day, … from local midnight on 1 January 1970: up to 1.2.0 it read the groups in that fixed order, so `dd.MM.yyyy` parsed `02.01.2025` as the year 2, and its UTC start (31 December west of UTC) overflowed short months. If `timestampParseFormat` is empty, values are treated as Unix epoch milliseconds.

Text alignment is column-type-driven (`getTextAlign`): numbers/timestamps end, booleans/state/image/edit center, others start.

### Demo harness

`demo/index.html` builds the tag dynamically from `package.json` version using `lit/static-html`, applies `demo/themes/light.json`, loads the Material Symbols font, adds a demo-only edit column (values from the Name column, `parameterKey: 'edit'`) and a board-page link to the default config, stands in for Studio by logging `param-submit` (mirrored into the demo URL) and `nav-submit`, and randomizes select cell values every 1s via the external `ObjectRandomizer.js` script — useful for verifying reactivity but means the demo will not run fully offline.

## Releasing

CI (`.github/workflows/build-publish.yml`) publishes to npm on the merge of a release pull request (`just release-patch`, a patch bump). Because the custom element name embeds the version, every release ships a new tag name; do not hand-edit the `versionplaceholder` literal.

## `aiSelection` in `src/definition-schema.json`

The schema root carries an `aiSelection` block next to `title` and `description`. It is **not** JSON Schema and describes no config field — it exists so the IronFlock AI's Widget Builder can pick the right widget for a given shape of data, using knowledge only the widget author has:

```jsonc
"aiSelection": {
  "dataShape": "…what columns this widget consumes and what each one means…",
  "useWhen":   ["…a situation, naming the properties that express it…"],
  "notFor":    ["…a situation this widget is wrong for, naming the widget to use instead…"]
}
```

It is inert everywhere else, and must stay that way: `json2ts` ignores it (the generated `.d.ts` is byte-identical with and without it), the dashboard config editor renders only `schema.properties`, and the AI service's `validate_widget` validates *configs* against the schema, skipping unknown Draft-7 keywords.

When maintaining it:

- `notFor` is the high-value half and the part plain descriptions always omit. Every entry must name the widget that *should* be used, or it rejects without routing.
- Write for an LLM with no other documentation: describe the visible result and the user's intent, not the implementation.
- Prefer entries that discriminate against a *neighbouring* widget. Generic rejections are cheap; the ones that pay are those an author could plausibly get wrong.
- The `notFor` lists are a set across all `widget-*` repos and are meant to be reciprocal — if this widget routes to another for some case, that widget should usually route back for the converse. Changing one side is a cue to check the other.
- Update it whenever a property changes what this widget can *do*, not just how it looks.
