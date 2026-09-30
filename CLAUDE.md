# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run start` — Vite dev server on port 8000 with `--watch` rebuild, opens `/demo/`.
- `npm run build` — Production library build (ES module) to `dist/`.
- `npm run watch` — Build only, watch mode.
- `npm run types` — Regenerate `src/definition-schema.d.ts` from `src/definition-schema.json` via `json2ts` (run after editing the schema).
- `npm run analyze` — Custom Elements Manifest analysis (`@custom-elements-manifest/analyzer --litelement`).
- `npm run release` — `npm version patch`: preflight guards (on `main`, clean tree, not behind `origin/main`, generated files current, build passes), then the bump and a `dist/` rebuild (the `version` hook, so the local build registers the new tag), then commit, bare-semver tag, `git push --follow-tags`, then waits on the CI run and fails if the npm publish fails. `npm run release:minor` / `release:major` for other bumps.
- `npm run link` / `npm run unlink` — Link/unlink against sibling `../RESWARM/frontend` for local integration.

No test framework or linter is configured. Node `>=24.9.0`, npm `>=10.0.2`.

## Architecture

Single-file Lit 3 web component (`src/widget-table.ts`) wrapping `@vaadin/grid` (peer dependency, externalized in the bundle). The component is registered as `widget-table-versionplaceholder`; the Vite build replaces `versionplaceholder` with the package version via `@rollup/plugin-replace`, so the live tag is e.g. `widget-table-1.1.17`. Consumers must use the version-suffixed tag matching the installed package — this lets multiple widget versions coexist on one page in the IronFlock dashboard.

Build pipeline (`vite.config.ts`):
- Library mode, ES-only output, entry `src/widget-table.ts` → `dist/widget-table.js`.
- Externalizes `lit*`, `@lit*`, `@vaadin*` so consumers provide them.
- `tslib` aliased to `tslib/tslib.es6.js`; `process.env.NODE_ENV` defined to `"production"`.

### IronFlock platform contract

The widget exposes two reactive properties consumed by the host dashboard:
- `inputData: TableConfiguration` — typed by `src/definition-schema.d.ts`, generated from `src/definition-schema.json`. The JSON schema is the source of truth for both the runtime type and the dashboard's config UI (note the non-standard `order`, `dataDrivenDisabled`, `condition.showIfValueIn`, and `color: true` keys consumed by the IronFlock config editor).
- `theme: { theme_name, theme_object }` — ECharts-style theme object. `registerTheme()` resolves colors with this precedence: CSS custom properties (`--re-text-color`, `--re-tile-background-color`, `--re-hover-color`, `--re-border-color`) on the host element override `theme_object` values. These are not snapshotted: `registerTheme()` stores a `var(--re-…, <theme value>)` chain, so a change to the host property repaints the tile live without the widget being told.

### Data shape and rendering

`inputData.columns` is column-oriented (each column carries its own `values[]`). `transformInputData()` pivots columns into row records keyed `col_<index>` for Vaadin Grid, then reverses (newest-first). Vaadin sort paths use `col_<index>.value`.

Cell rendering dispatches on `column.type` in `renderCell()`: `string`, `number` (with `precision`), `boolean`, `state` (parses `stateMap` string `"'ONLINE': 'green', ..."` into a colored `.statusbox`), `button`, `image`, `timestamp`. Timestamps use a hand-rolled Unicode LDML subset (`yyyy MM dd HH mm ss SSS`) — see `parseTimestamp` / `formatTimestamp`. If `timestampParseFormat` is empty, values are treated as Unix epoch milliseconds.

Text alignment is column-type-driven (`getTextAlign`): numbers/timestamps end, booleans/state/image center, others start.

### Demo harness

`demo/index.html` builds the tag dynamically from `package.json` version using `lit/static-html`, applies `demo/themes/light.json`, and randomizes select cell values every 1s via the external `ObjectRandomizer.js` script — useful for verifying reactivity but means the demo will not run fully offline.

## Releasing

CI (`.github/workflows/build-publish.yml`) publishes to npm on any pushed tag. The standard flow is `npm run release` (patch bump). Because the custom element name embeds the version, every release ships a new tag name; do not hand-edit the `versionplaceholder` literal.

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
