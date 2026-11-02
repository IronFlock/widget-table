import { html, css, LitElement, PropertyValues, nothing } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import { property, state, customElement } from 'lit/decorators.js'
import { TableConfiguration, Values } from './definition-schema.js'

import '@vaadin/grid'
import '@vaadin/grid/vaadin-grid-column.js'
import '@vaadin/grid/vaadin-grid-sort-column.js'
import { columnBodyRenderer, columnHeaderRenderer } from '@vaadin/grid/lit.js'
import '@material/web/icon/icon.js'
import '@material/web/iconbutton/icon-button.js'

type Column = Exclude<TableConfiguration['columns'], undefined>[number]
type RowData = { [key: string]: Values[number] }
type Theme = {
    theme_name: string
    theme_object: any
}
let colorContext: CanvasRenderingContext2D | null | undefined

// The icon an edit column shows while styling.iconName is empty.
const DEFAULT_EDIT_ICON = 'edit'

// An edit column without a width of its own: its button plus the cell padding,
// which is set on the grid as a custom property and inherits into the cells.
const EDIT_COLUMN_WIDTH = 'calc(2 * var(--cell-padding-horizontal, 16px) + 2.5em)'

// A link with a scheme (https:, mailto:) or a protocol-relative one is a web
// address; anything else is the path of a board page for Studio to open.
const isExternalLink = (link: string): boolean => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(link)

// A colour as [r, g, b, alpha] in sRGB (channels 0-255), parsed by the browser
// itself through a canvas's fillStyle, so names, hsl(), hex with alpha,
// color-mix() and the like all work. A value the browser rejects comes back
// fully transparent, the way an invalid background-color leaves a tile. Only
// the normalised string is read, never pixels: with Firefox's
// resistFingerprinting on, as in Tor Browser, getImageData() answers with
// random colours.
const parseColor = (value: string): number[] => {
    colorContext ??= document.createElement('canvas').getContext('2d')
    if (!colorContext) return [0, 0, 0, 0]
    // Chromium hands oklch(), lab(), color() and the like back as written;
    // mixed into srgb they come back as color(srgb r g b / alpha). It rejects
    // light-dark() outright but takes it inside color-mix().
    for (const candidate of [value, `color-mix(in srgb, ${value} 100%, transparent)`]) {
        // A rejected value leaves the previous fillStyle in place, so set it
        // after two different placeholders: only an accepted one reads the same.
        colorContext.fillStyle = '#000'
        colorContext.fillStyle = candidate
        const color = String(colorContext.fillStyle)
        colorContext.fillStyle = '#fff'
        colorContext.fillStyle = candidate
        if (String(colorContext.fillStyle) !== color) continue
        let match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/.exec(color)
        if (match) return [...match.slice(1).map((hex) => parseInt(hex, 16)), 1]
        match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color)
        if (match) return match.slice(1).map(Number)
        match = /^color\(srgb (\S+) (\S+) (\S+)(?: \/ (\S+))?\)$/.exec(color)
        if (match) {
            const [r, g, b] = match.slice(1, 4).map((v) => Math.min(Math.max(Number(v) || 0, 0), 1) * 255)
            return [r, g, b, Number(match[4] ?? 1) || 0]
        }
    }
    return [0, 0, 0, 0]
}

const surfaceCache = new Map<string, string>()

// Paint the given colours, bottom first, over white, as the screen composites
// a translucent background over what is behind it, and return the opaque
// result as #rrggbb.
const opaqueSurface = (layers: string[]): string => {
    const key = JSON.stringify(layers)
    const cached = surfaceCache.get(key)
    if (cached !== undefined) return cached

    let surface = [255, 255, 255]
    for (const layer of layers) {
        const [r, g, b, alpha] = parseColor(layer)
        surface = [r, g, b].map((channel, i) => channel * alpha + surface[i] * (1 - alpha))
    }
    const hex = '#' + surface.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')
    surfaceCache.set(key, hex)
    return hex
}

@customElement('widget-table-versionplaceholder')
export class WidgetTable extends LitElement {
    @property({ type: Object })
    inputData?: TableConfiguration

    @property({ type: Object })
    theme?: Theme

    @state()
    rows: RowData[] = []

    @state() private themeTitleColor?: string
    @state() private themeSubtitleColor?: string
    @state() private themeRowHoverColor?: string
    @state() private themeBorderColor?: string

    version: string = 'versionplaceholder'

    update(changedProperties: Map<string, any>) {
        if (changedProperties.has('inputData')) {
            this.transformInputData()
        }

        if (changedProperties.has('theme')) {
            this.registerTheme(this.theme)
        }

        super.update(changedProperties)
    }

    protected firstUpdated(_changedProperties: PropertyValues): void {
        this.registerTheme(this.theme)
    }

    registerTheme(theme?: Theme) {
        this.themeTitleColor = `var(--re-text-color, ${this.theme?.theme_object?.title?.textStyle?.color || 'inherit'})`
        this.themeSubtitleColor = `var(--re-text-color, ${this.theme?.theme_object?.title?.subtextStyle?.color || this.theme?.theme_object?.title?.textStyle?.color || 'inherit'})`
        this.themeRowHoverColor = `var(--re-hover-color, ${this.computeHoverColor(this.theme?.theme_object?.backgroundColor) || 'transparent'})`
        this.themeBorderColor = `var(--re-border-color, ${this.computeBorderColor(this.theme?.theme_object?.title?.textStyle?.color) || 'currentColor'})`
    }

    private computeHoverColor(bgColor?: string): string {
        // Create a subtle hover effect based on background
        if (!bgColor || bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)') {
            return 'rgba(128, 128, 128, 0.1)'
        }
        return 'rgba(128, 128, 128, 0.1)'
    }

    private computeBorderColor(textColor?: string): string {
        // Create a subtle border color based on text color
        if (!textColor) {
            return 'rgba(128, 128, 128, 0.2)'
        }
        return 'rgba(128, 128, 128, 0.2)'
    }

    transformInputData() {
        if (!this?.inputData?.columns?.length) {
            this.rows = []
            return
        }

        const cols = this.inputData.columns.map((col) => col?.values ?? [])
        const maxLength = Math.max(...cols.map((vals) => vals?.length ?? 0))
        const rows: RowData[] = []

        for (let r = 0; r < maxLength; r++) {
            const row: RowData = {}
            for (let c = 0; c < cols.length; c++) {
                row[`col_${c}`] = cols?.[c]?.[r] ?? {}
            }
            rows.push(row)
        }

        this.rows = rows
    }

    /**
     * A cell is empty when the data source has no value for it. Empty is a
     * legitimate value (e.g. a `detail` column that is only filled for error
     * rows), not a reason to skip the themed cell markup.
     */
    isEmptyValue(value: unknown) {
        return value === undefined || value === null || value === ''
    }

    /**
     * Neutral stand-in for an empty cell. Colored via `currentColor` so it
     * follows the column/theme text color instead of a fixed default.
     */
    renderEmptyValue() {
        return html`<span class="empty-value">–</span>`
    }

    /**
     * The value an edit button sends: text, a number or a boolean, as text.
     * Nothing for an empty cell, and nothing for an object (a JSON column),
     * which could only arrive as "[object Object]".
     */
    parameterValue(value: unknown): string | undefined {
        if (this.isEmptyValue(value) || typeof value === 'object') return undefined
        return String(value).trim() || undefined
    }

    /**
     * Ask Studio to set a URL parameter. Studio merges it into the page URL,
     * hands every widget on the page the new route and re-queries bindings
     * whose filter uses the parameter. The widget never touches the URL.
     */
    submitParameter(key: string, value: string) {
        this.dispatchEvent(
            new CustomEvent('param-submit', {
                detail: { params: { [key]: value } },
                bubbles: true,
                composed: true
            })
        )
    }

    /** Ask Studio to open a board page: `/x` from the board root, else next to the current page. */
    navigate(path: string) {
        this.dispatchEvent(new CustomEvent('nav-submit', { detail: { path }, bubbles: true, composed: true }))
    }

    renderCell(cell: Values[number], colIndex: number) {
        const colDef = this?.inputData?.columns?.[colIndex]
        if (!colDef) return nothing

        switch (colDef?.type) {
            case 'string':
                return this.renderString(cell?.value, colDef)
            case 'number':
                return this.renderNumber(cell?.value, colDef)
            case 'boolean':
                return this.renderBoolean(cell?.value, colDef)
            case 'state':
                return this.renderState(cell?.value, colDef)
            case 'button':
                return this.renderButton(cell, colDef)
            case 'image':
                return this.renderImage(cell, colDef)
            case 'edit':
                return this.renderEditButton(cell, colDef)
            case 'timestamp':
                return this.renderTimestamp(cell?.value, colDef)
            default:
                return this.isEmptyValue(cell?.value) ? this.renderEmptyValue() : html`${cell?.value}`
        }
    }

    renderString(value: string | undefined, colDef: Column) {
        if (this.isEmptyValue(value)) return this.renderEmptyValue()
        return html`${value}`
    }

    renderNumber(value: any, colDef: Column) {
        if (this.isEmptyValue(value)) return this.renderEmptyValue()
        const num = typeof value === 'number' ? value : parseFloat(value)
        if (isNaN(num)) return this.renderEmptyValue()
        const precision = colDef?.styling?.precision ?? 0
        return html`${num.toFixed(precision)}`
    }

    renderBoolean(value: any, colDef: Column) {
        if (this.isEmptyValue(value)) return this.renderEmptyValue()
        // Values arrive from the data source as strings, so 'false'/'0'/'no'
        // must not be treated as truthy.
        const falsy = ['false', '0', 'no', 'off']
        const isTrue = typeof value === 'string' ? !falsy.includes(value.trim().toLowerCase()) : !!value
        return html`${isTrue ? '✓' : '-'}`
    }

    /**
     * Accepts both the documented `'ONLINE': 'green', 'FAILED': 'red'` form and
     * the flat `'ONLINE', 'green', 'FAILED', 'red'` pair list. Splitting on the
     * colon as well as the comma is what makes the documented form work — without
     * it every value stays unmapped and the whole column renders as one flat
     * fallback color.
     */
    parseStateMap(stateMap?: string): { [key: string]: string } {
        const tokens =
            stateMap
                ?.split(/[,:]/)
                .map((token: string) =>
                    token
                        .trim()
                        .replace(/^['"]|['"]$/g, '')
                        .trim()
                )
                .filter((token: string) => token !== '') ?? []

        const map: { [key: string]: string } = {}
        for (let i = 0; i + 1 < tokens.length; i += 2) {
            map[tokens[i]] = tokens[i + 1]
        }
        return map
    }

    renderState(value: any, colDef: Column) {
        if (this.isEmptyValue(value)) return this.renderEmptyValue()

        const stateMap = this.parseStateMap(colDef.styling?.stateMap)
        const color = stateMap[String(value)]
        // Unmapped states fall back to a tint of the text color (see
        // `.statusbox-unmapped`) — a fixed grey would ignore the dashboard theme.
        return color
            ? html`<div class="statusbox" style="background-color: ${color}"></div>`
            : html`<div class="statusbox statusbox-unmapped"></div>`
    }

    /**
     * A cell's content in its link. A web address opens in a new tab; a path,
     * such as /machines/press-1, is a board page that Studio opens in place
     * (nav-submit). The page link is a real button rather than an anchor with
     * a relative href: a middle-click on that anchor would open the path
     * against Studio's origin in a new tab, where it is no page. No link
     * leaves the content as it is.
     */
    renderLink(content: unknown, link: unknown) {
        const href = typeof link === 'string' ? link.trim() : ''
        if (!href) return html`${content}`
        if (isExternalLink(href))
            return html`<a href=${href} target="_blank" rel="noopener noreferrer">${content}</a>`
        return html`<button type="button" class="link-button" @click=${() => this.navigate(href)}>
            ${content}
        </button>`
    }

    renderButton(cell: Values[number], colDef: Column) {
        if (this.isEmptyValue(cell?.value)) return this.renderEmptyValue()
        return this.renderLink(cell?.value, cell?.link)
    }

    renderImage(cell: Values[number], colDef: Column) {
        if (this.isEmptyValue(cell?.value)) return this.renderEmptyValue()
        return this.renderLink(html`<img src="${cell.value}" />`, cell?.link)
    }

    /**
     * An edit column's cell: an icon button that hands the row's value, the
     * record key, to Studio as a URL parameter (param-submit), for a form that
     * opens on that parameter or a widget filtering on it. Without a key the
     * button is disabled, with the reason as a tooltip on the wrapper: a
     * disabled Material button has pointer-events: none, so a title on the
     * button itself never shows. vaadin-grid does not count md-icon-button as
     * focusable: focus-target lets Enter in the cell reach it, and
     * skipCellActivate keeps the click from also toggling the row's active
     * item. The label names the row, so screen readers can tell the buttons
     * apart.
     */
    renderEditButton(cell: Values[number], colDef: Column) {
        const value = this.parameterValue(cell?.value)
        if (value === undefined) return this.renderEmptyValue()
        const key = String(colDef.styling?.parameterKey ?? '').trim()
        const icon = String(colDef.styling?.iconName ?? '').trim() || DEFAULT_EDIT_ICON
        const label = String(colDef.header ?? '').trim() || 'Edit'
        return html`<span
            class="edit-button"
            title=${key ? nothing : "Set the column's URL Parameter Key to enable this button"}
        >
            <md-icon-button
                focus-target
                ?disabled=${!key}
                aria-label="${label} ${value}"
                @click=${(event: Event) => {
                    ;(event as Event & { skipCellActivate?: boolean }).skipCellActivate = true
                    if (key) this.submitParameter(key, value)
                }}
                ><md-icon>${icon}</md-icon></md-icon-button
            >
        </span>`
    }

    renderTimestamp(value: any, colDef: Column) {
        if (this.isEmptyValue(value)) return this.renderEmptyValue()

        const parseFormat = colDef.styling?.timestampParseFormat
        const displayFormat = colDef.styling?.timestampFormat

        let date: Date

        if (parseFormat) {
            // Parse using custom format
            date = this.parseTimestamp(String(value), parseFormat)
        } else {
            // Default: expect Unix epoch milliseconds
            const timestamp = typeof value === 'number' ? value : parseInt(value, 10)
            if (isNaN(timestamp)) return this.renderEmptyValue()
            date = new Date(timestamp)
        }

        if (isNaN(date.getTime())) return this.renderEmptyValue()

        if (displayFormat) {
            return html`${this.formatTimestamp(date, displayFormat)}`
        }
        return html`${date.toISOString()}`
    }

    parseTimestamp(value: string, format: string): Date {
        // Unicode LDML format tokens: yyyy, MM, dd, HH, mm, ss, SSS
        // See: https://unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table
        const formatTokens: { [key: string]: { regex: string; setter: (d: Date, v: number) => void } } = {
            yyyy: { regex: '(\\d{4})', setter: (d, v) => d.setFullYear(v) },
            MM: { regex: '(\\d{2})', setter: (d, v) => d.setMonth(v - 1) },
            dd: { regex: '(\\d{2})', setter: (d, v) => d.setDate(v) },
            HH: { regex: '(\\d{2})', setter: (d, v) => d.setHours(v) },
            mm: { regex: '(\\d{2})', setter: (d, v) => d.setMinutes(v) },
            ss: { regex: '(\\d{2})', setter: (d, v) => d.setSeconds(v) },
            SSS: { regex: '(\\d{3})', setter: (d, v) => d.setMilliseconds(v) }
        }

        let regexStr = format.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
        const tokens: string[] = []

        for (const token of ['yyyy', 'SSS', 'MM', 'dd', 'HH', 'mm', 'ss']) {
            if (regexStr.includes(token)) {
                regexStr = regexStr.replace(token, formatTokens[token].regex)
                tokens.push(token)
            }
        }

        const match = value.match(new RegExp(`^${regexStr}$`))
        if (!match) return new Date(NaN)

        const date = new Date(0)
        tokens.forEach((token, i) => {
            formatTokens[token].setter(date, parseInt(match[i + 1], 10))
        })

        return date
    }

    formatTimestamp(date: Date, format: string): string {
        const pad = (n: number, len = 2) => String(n).padStart(len, '0')

        // Unicode LDML format tokens
        // See: https://unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table
        return format
            .replace('yyyy', String(date.getFullYear()))
            .replace('MM', pad(date.getMonth() + 1))
            .replace('dd', pad(date.getDate()))
            .replace('HH', pad(date.getHours()))
            .replace('mm', pad(date.getMinutes()))
            .replace('ss', pad(date.getSeconds()))
            .replace('SSS', pad(date.getMilliseconds(), 3))
    }

    getTextAlign(colDef: Column) {
        switch (colDef.type) {
            case 'number':
            case 'timestamp':
                return 'end'
            case 'button':
            case 'string':
                return 'start'
            case 'boolean':
            case 'state':
            case 'image':
            case 'edit':
                return 'center'
            default:
                return 'start'
        }
    }

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            font-family: sans-serif;
            box-sizing: border-box;
            position: relative;
            height: 100%;
            width: 100%;
            flex: 1;
        }

        .paging:not([active]) {
            display: none !important;
        }

        .wrapper {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            min-width: 0;
        }

        h3 {
            margin: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding: 16px 0px 0px 16px;
            box-sizing: border-box;
        }
        p {
            margin: 10px 0 16px 0;
            font-size: 14px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            padding-left: 16px;
            box-sizing: border-box;
        }

        vaadin-grid {
            flex: 1;
            --vaadin-grid-cell-padding: var(--cell-padding-vertical, 8px) var(--cell-padding-horizontal, 16px);
            --vaadin-grid-column-border-width: var(--grid-column-border-width, 0);
            --vaadin-grid-border-color: var(--grid-border-color, rgba(128, 128, 128, 0.3));
            background: var(--grid-bg-color, transparent);
            /* Vaadin paints rows with --vaadin-background-color (opaque white)
               by default, which shows through wherever a cell is transparent.
               --grid-bg-color is left unset, so the grid, its rows and cells stay
               transparent and the tile that studio's widget-item paints shows
               through once; painting the tile colour here too stacked it several
               times. Only the sticky header is opaque (headerSurfaceColor()). */
            --vaadin-grid-row-background-color: var(--grid-bg-color, transparent);
            --vaadin-background-color: var(--grid-bg-color, transparent);
        }

        vaadin-grid::part(cell) {
            background: var(--grid-bg-color, transparent);
            color: var(--grid-text-color, inherit);
        }

        vaadin-grid::part(header-cell) {
            font-size: var(--header-font-size, 14px);
            background: var(--grid-header-bg-color, transparent);
            color: var(--grid-text-color, inherit);
        }

        vaadin-grid::part(body-cell) {
            background: var(--grid-bg-color, transparent);
            color: var(--grid-text-color, inherit);
        }

        vaadin-grid::part(even-row-cell) {
            background: var(--grid-bg-color, transparent);
        }

        vaadin-grid::part(odd-row-cell) {
            background: var(--grid-bg-color, transparent);
        }

        vaadin-grid-sorter {
            flex: 1;
            justify-content: inherit;
        }

        vaadin-grid-cell-content {
            display: flex;
            align-items: center;
            height: 100%;
        }

        .grid-container {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            min-width: 0;
            overflow: hidden;
            /* Derive scrollbar colors from the (inherited) text color so they
               follow custom styles and themes — e.g. light thumb on dark bg.
               Inherits into vaadin-grid's shadow DOM for browsers that honor it. */
            scrollbar-width: thin;
            scrollbar-color: color-mix(in srgb, currentColor 35%, transparent) transparent;
        }

        .grid-container.overflow {
            overflow-x: auto;
        }

        .grid-container.overflow vaadin-grid {
            min-width: max-content;
        }

        /* WebKit/Blink fallback for browsers without scrollbar-color support. */
        .grid-container::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        .grid-container::-webkit-scrollbar-track {
            background: transparent;
        }

        .grid-container::-webkit-scrollbar-thumb {
            background-color: color-mix(in srgb, currentColor 35%, transparent);
            border-radius: 4px;
        }

        .grid-container::-webkit-scrollbar-thumb:hover {
            background-color: color-mix(in srgb, currentColor 55%, transparent);
        }

        .statusbox {
            width: 24px;
            height: 12px;
            border-radius: 6px;
        }

        /* A state that the stateMap does not cover — tint the inherited text
           color so the swatch follows the dashboard theme. */
        .statusbox-unmapped {
            background-color: color-mix(in srgb, currentColor 25%, transparent);
        }

        /* Placeholder for cells the data source left empty. Derived from the
           cell's own color so it is muted in both light and dark themes. */
        .empty-value {
            opacity: 0.45;
        }

        img {
            max-width: 100%;
            max-height: 40px;
            object-fit: contain;
        }

        .no-data {
            font-size: 20px;
            display: flex;
            height: 100%;
            width: 100%;
            text-align: center;
            align-items: center;
            justify-content: center;
        }

        .cell {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
        }

        .cell-center {
            justify-content: center;
        }

        .cell-end {
            justify-content: flex-end;
        }

        .cell-start {
            justify-content: flex-start;
        }

        a,
        a:visited,
        a:hover,
        a:active {
            color: inherit;
            text-decoration: underline;
        }

        /* A button column's link to a board page, drawn like the anchors. */
        .link-button {
            all: unset;
            cursor: pointer;
            color: inherit;
            font: inherit;
            text-decoration: underline;
        }

        .link-button:focus-visible {
            outline: auto;
        }

        /* An edit column's icon button, sized by the cell's font (Material's
           40px button would make these rows taller than text rows) and
           coloured by the cell's text: currentColor, substituted into
           Material's shadow DOM, resolves to the .cell colour chain, so a
           board style edit repaints it. The focus ring's default is a Material
           system colour that is invisible on a dark tile. */
        .edit-button {
            display: inline-flex;
        }

        md-icon-button {
            --md-icon-button-icon-size: 1.25em;
            --md-icon-button-state-layer-width: 2em;
            --md-icon-button-state-layer-height: 2em;
            --md-icon-button-icon-color: currentColor;
            --md-icon-button-hover-icon-color: currentColor;
            --md-icon-button-focus-icon-color: currentColor;
            --md-icon-button-pressed-icon-color: currentColor;
            --md-icon-button-disabled-icon-color: currentColor;
            --md-icon-button-hover-state-layer-color: currentColor;
            --md-icon-button-pressed-state-layer-color: currentColor;
            --md-focus-ring-color: currentColor;
        }
    `

    /**
     * Opaque colour for the sticky header, so rows scrolling under it stay
     * hidden: the tile as it is displayed, --re-tile-background-color over the
     * dashboard's --re-background-color over white. The theme background fills
     * in for a missing tile colour or, standalone, for the dashboard's. The
     * colours are read at render time, because a var() chain cannot be
     * composited in JS.
     */
    private headerSurfaceColor(): string {
        const style = getComputedStyle(this)
        const tile = style.getPropertyValue('--re-tile-background-color').trim()
        const dashboard = style.getPropertyValue('--re-background-color').trim()
        const themeBg = String(this.theme?.theme_object?.backgroundColor ?? '')
        return opaqueSurface(dashboard ? [dashboard, tile || themeBg] : [themeBg, tile])
    }

    /**
     * The body renderer of a column: the cell's content in the column's font
     * and colour. An edit column is a plain vaadin-grid-column (sorting by the
     * record key means nothing, and the sort column forbids a header renderer)
     * whose header is centred by a renderer: the cell content is a flex
     * container (see the styles), so vaadin's textAlign alone does not centre
     * a bare header text.
     */
    private cellRenderer(col: Column, colIndex: number) {
        return (item: RowData) => html`
            <div
                class="cell cell-${this.getTextAlign(col)}"
                style="font-size: ${col.styling?.fontSize}; font-weight: ${col.styling
                    ?.fontWeight}; color: ${col.styling?.color || this.themeTitleColor}"
            >
                ${this.renderCell(item[`col_${colIndex}`], colIndex)}
            </div>
        `
    }

    render() {
        const columns = this.inputData?.columns ?? []

        return html`
            <div class="wrapper" style="color: ${this.themeTitleColor}">
                <header>
                    <h3 class="paging" ?active=${this.inputData?.title}>${this.inputData?.title}</h3>
                    <p
                        class="paging"
                        ?active=${this.inputData?.subTitle}
                        style="color: ${this.themeSubtitleColor}"
                    >
                        ${this.inputData?.subTitle}
                    </p>
                </header>

                <div class="grid-container ${this.inputData?.horizontalOverflow ? 'overflow' : ''}">
                    <vaadin-grid
                        class="paging"
                        ?active=${this.rows?.length}
                        .items=${this.rows}
                        theme="no-row-borders no-border"
                        style="
                            --header-font-size: ${this.inputData?.styling?.headerFontSize || '14px'};
                            --cell-padding-horizontal: ${this.inputData?.styling?.cellPaddingHorizontal ||
                        '16px'};
                            --cell-padding-vertical: ${this.inputData?.styling?.cellPaddingVertical || '8px'};
                            --grid-header-bg-color: ${this.headerSurfaceColor()};
                            --grid-text-color: ${this.themeTitleColor || 'inherit'};
                            --grid-hover-color: ${this.themeRowHoverColor || 'rgba(128, 128, 128, 0.1)'};
                            --grid-column-border-width: ${this.inputData?.styling?.columnSeparators
                            ? '1px'
                            : '0'};
                            --grid-border-color: ${this.themeBorderColor || 'rgba(128, 128, 128, 0.3)'};
                        "
                    >
                        ${repeat(
                            columns,
                            (col, i) => `${col.header}-${i}`,
                            (col, colIndex) =>
                                col?.type === 'edit'
                                    ? html`
                                          <vaadin-grid-column
                                              .flexGrow=${0}
                                              width=${col.styling?.width || EDIT_COLUMN_WIDTH}
                                              resizable
                                              .textAlign=${'center'}
                                              ${columnHeaderRenderer(
                                                  () =>
                                                      html`<div class="cell cell-center">${col.header}</div>`,
                                                  [col.header]
                                              )}
                                              ${columnBodyRenderer<RowData>(
                                                  this.cellRenderer(col, colIndex),
                                                  [colIndex, col, this.themeTitleColor]
                                              )}
                                          ></vaadin-grid-column>
                                      `
                                    : html`
                                          <vaadin-grid-sort-column
                                              .flexGrow=${col.styling?.width ? 0 : 1}
                                              width=${ifDefined(
                                                  col.styling?.width ? `${col.styling.width}` : undefined
                                              )}
                                              ?autoWidth=${this.inputData?.horizontalOverflow &&
                                              !col.styling?.width}
                                              resizable
                                              .textAlign=${this.getTextAlign(col)}
                                              .header=${col.header}
                                              path=${`col_${colIndex}.value`}
                                              ${columnBodyRenderer<RowData>(
                                                  this.cellRenderer(col, colIndex),
                                                  [colIndex, col, this.themeTitleColor]
                                              )}
                                          ></vaadin-grid-sort-column>
                                      `
                        )}
                    </vaadin-grid>
                </div>

                <div class="paging no-data" ?active=${!this.rows?.length}>No Data</div>
            </div>
        `
    }
}
