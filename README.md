# \<widget-table>

A Lit 3.x web component for rendering data tables with sortable columns, powered by Vaadin Grid. Part of the IronFlock widget ecosystem.

![screenshot](thumbnail.png)

## Installation

```bash
npm i @ironflock/widget-table
```

**Peer Dependencies:** This widget requires `@vaadin/grid` and `@material/web` to be installed in your application. An `edit` column draws its icon with `md-icon`, which needs the "Material Symbols Outlined" font on the page (IronFlock Studio loads it; a standalone page adds the Google Fonts link, see `demo/index.html`).

## Usage

The custom element's tag carries the installed version (`widget-table-<version>`), so several versions can share a page. Build it from the package's version rather than writing it out:

```javascript
import '@ironflock/widget-table'
import { version } from '@ironflock/widget-table/package.json' with { type: 'json' }

const table = document.createElement(`widget-table-${version}`)
document.body.append(table)
table.inputData = {
    title: 'Device Status',
    subTitle: 'Current readings',
    columns: [
        {
            header: 'Device',
            type: 'string',
            values: [{ value: 'Sensor A' }, { value: 'Sensor B' }]
        },
        {
            header: 'Status',
            type: 'state',
            values: [{ value: 'ONLINE' }, { value: 'OFFLINE' }],
            styling: { stateMap: "'ONLINE': 'green', 'OFFLINE': 'red'" }
        },
        {
            header: 'Temperature',
            type: 'number',
            values: [{ value: '23.456' }, { value: '18.912' }],
            styling: { precision: 1 }
        }
    ]
}
```

## TableConfiguration Interface

```ts
interface TableConfiguration {
    title?: string
    subTitle?: string
    horizontalOverflow?: boolean
    styling?: {
        headerFontSize?: string // e.g. '14px'
        cellPaddingHorizontal?: string // e.g. '16px' or '1rem'
        cellPaddingVertical?: string // e.g. '8px' or '1rem'
    }
    columns?: Column[]
}

interface Column {
    header: string
    type: 'string' | 'number' | 'boolean' | 'state' | 'button' | 'image' | 'timestamp' | 'edit'
    values: { value: string; link?: string }[]
    sortDirection?: 'none' | 'asc' | 'desc' // Sort the rows by this column (see Sorting)
    sortPriority?: number // 1 sorts first when several columns are sorted
    styling?: {
        parameterKey?: string // edit: the URL parameter the button sets
        iconName?: string // edit: Material Symbols icon name, 'edit' by default
        precision?: number // Decimal places for number type
        stateMap?: string // e.g. "'ONLINE': 'green', 'OFFLINE': 'red'"
        width?: string // Column width e.g. '150px'
        fontSize?: string
        fontWeight?: string // e.g. '800' for bold
        color?: string // Font color
        border?: string // e.g. '1px solid red'
    }
}
```

## Column Types

| Type        | Description                                                                   |
| ----------- | ----------------------------------------------------------------------------- |
| `string`    | Plain text display                                                            |
| `number`    | Numeric value with optional precision formatting                              |
| `boolean`   | Boolean display                                                               |
| `state`     | Status indicator with colored dot based on stateMap                           |
| `timestamp` | Epoch milliseconds, or a `timestampParseFormat`, shown as `timestampFormat`   |
| `button`    | The value as a link (see Links)                                               |
| `image`     | The value as an image, with an optional link (see Links)                      |
| `edit`      | An icon button that sends the value as a URL parameter (see Edit column)      |

### Links

A `button` or `image` cell's `link` opens when it is clicked. A web address (one with a scheme, such as `https://example.com`) opens in a new tab. A path without a scheme, such as `/machines/press-1`, is a board page: the widget dispatches `nav-submit` and IronFlock Studio opens the page in place (`/x` from the board root, anything else next to the current page). An empty link shows the value or image without a link.

### Edit column

A column of type `edit` shows one icon button per row (a pen, or `styling.iconName`) instead of its values. Bind its values to the record's key column: a click dispatches `param-submit` with that key under `styling.parameterKey`, Studio writes it into the page URL, and a `widget-form` whose "Open on URL parameter" names the same parameter opens pre-filled with the record. Any other widget on the page can follow the parameter too, with a Parameter filter on its binding. Without a `parameterKey` the button is disabled, with the reason as its tooltip; an empty value shows the empty-cell placeholder.

```javascript
{
    header: 'Edit',
    type: 'edit',
    values: [{ value: 'press-1' }, { value: 'press-2' }], // bound to machine_id in Studio
    styling: { parameterKey: 'edit' }
}
```

The column is centred, not sortable, and as narrow as its button unless `styling.width` says otherwise.

### Sorting

Rows show in the order the data arrives (oldest first, from IronFlock Studio) unless columns set a `sortDirection`. Each column type sorts by what it shows: numbers by value, timestamps by time (with `timestampParseFormat` if set), booleans false first, a `state` column in the order its `stateMap` lists the states (unlisted states after, alphabetically), and text naturally and case-insensitively (`Pump 2` before `Pump 10`). Empty or unparseable cells come last in both directions, and rows that tie keep their arrival order. `image` and `edit` columns are not sortable.

When several columns are sorted, `sortPriority` decides which counts first (1, then 2, …); sorted columns without one come after, left to right.

```javascript
// The alarms first (the order of the stateMap), the newest first within each state
{ header: 'State', type: 'state', sortDirection: 'asc', sortPriority: 1, styling: { stateMap: "'FAILED': 'red', 'OK': 'green'" }, values }
{ header: 'Time', type: 'timestamp', sortDirection: 'desc', sortPriority: 2, values }
```

The headers show the sort, with its order when there is more than one sorted column. A viewer can click a header (or press Space on it) to sort by that column alone: ascending, descending, then back to the configured sort. That choice survives data updates but not a reload or a change of the sort settings.

## Events

The widget never changes the page URL itself. It asks the host to, on the element:

| Event          | Detail                                 | When                                                           |
| -------------- | -------------------------------------- | -------------------------------------------------------------- |
| `param-submit` | `{ params: { [parameterKey]: value } }` | An `edit` button is clicked; Studio merges it into the page URL |
| `nav-submit`   | `{ path }`                              | A `button` or `image` link to a board page is clicked           |

Both bubble and are composed.

## Features

- **Sorting**: A configured sort by one or more columns, and headers that viewers click to sort
- **Row actions**: Links to pages or web addresses, and an edit button that hands the row to a form
- **Resizable columns**: Drag column borders to resize
- **Horizontal overflow**: Enable scrolling for wide tables
- **Theme support**: Integrates with IronFlock theming system
- **State indicators**: Visual status dots with customizable color mapping

## Theming

The widget respects the CSS custom property `--re-text-color` (text, including the edit buttons). It paints no background of its own: the host's tile shows through.

Pass a theme object for ECharts-style theming:

```javascript
table.theme = {
    theme_name: 'dark',
    theme_object: {
        /* theme config */
    }
}
```

## Development

```bash
npm run start    # Dev server at localhost:8000/demo/
npm run build    # Production build to dist/
npm run types    # Regenerate types from schema
just release-patch  # release pull request; its merge publishes to npm
```

## Local Demo

```bash
npm start
```

Serves the demo at `demo/index.html` with sample data.
