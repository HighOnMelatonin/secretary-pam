// Limits on what can be saved, shared by the forms and the Worker so they agree. The forms stop
// the user going past them, and the Worker rejects anything past them sent straight to the API.

export const MAX_ID_LENGTH = 100
export const MAX_NAME_LENGTH = 200 // project, task and tag names, and link labels
export const MAX_DESCRIPTION_LENGTH = 10_000
export const MAX_URL_LENGTH = 2_000
export const MAX_LIST_LENGTH = 500 // tasks, links, tags or relations on one project or task

// Schemes a reference link may use. Any other, such as javascript: or data:, could run code in
// the app when the link is clicked.
export const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:']

export function isSafeUrl(url: string) {
  try {
    return LINK_PROTOCOLS.includes(new URL(url).protocol)
  } catch {
    return false // not an absolute URL
  }
}

// For rendering a stored link: links saved before the check was added could still be unsafe, so
// they get no href rather than a clickable one
export const safeHref = (url: string) => (isSafeUrl(url) ? url : undefined)
