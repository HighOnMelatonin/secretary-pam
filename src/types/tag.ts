// Tag data model: a label such as "Work" that a project can be filed under. Projects
// refer to their tags by id, so renaming a tag renames it on every project.
export interface Tag {
  id: string
  name: string // unique, ignoring case
  color: string // "#rrggbb", the fill of its badges and selected filter chip
}

// Indigo (--pam-indigo in main.css), the colour every tag had before tags could be recoloured
export const DEFAULT_TAG_COLOR = '#343ca6'

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

// The two text colours of the palette (--pam-cream and --pam-green in main.css)
const CREAM = '#faefe0'
const GREEN = '#204030'

// WCAG relative luminance and contrast ratio, from 1 (none) to 21 (black on white)
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

// Cream or forest green, whichever is easier to read on the colour
export const textColorOn = (fill: string) => (contrastRatio(fill, CREAM) >= contrastRatio(fill, GREEN) ? CREAM : GREEN)

// CSS variables for anything that shows the tag in its colour (.project-tag and the tag filter
// chips in main.css and listControls.vue). A stored colour that isn't a hex code shows as indigo.
export function tagStyle(tag: Tag) {
  const fill = isHexColor(tag.color) ? tag.color : DEFAULT_TAG_COLOR
  return { '--pam-tag-fill': fill, '--pam-tag-text': textColorOn(fill) }
}

// Built-in tag (created by migrations/0003) that a project gets when its last task is
// completed. Archived projects are listed apart from the live ones; removing the tag brings a
// project back. It can be renamed but not deleted.
export const ARCHIVE_TAG_ID = 'archive'

// Stands for "no tags" in a tag filter, beside the tags' own ids
export const NO_TAG = ''

export function createEmptyTag(): Tag {
  return { id: crypto.randomUUID(), name: '', color: DEFAULT_TAG_COLOR }
}
