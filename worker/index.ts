// API for storing projects and tasks in D1. Requests outside /api/* never reach
// this Worker: they are served from the built Vue app (see wrangler.jsonc).
//
//   GET    /api/projects       -> Project[]
//   PUT    /api/projects/:id   -> saves the Project in the body, returns it
//   DELETE /api/projects/:id   -> 204
//
// and the same for /api/tasks.

// Maps each URL resource to its table, so only these names ever reach SQL
const TABLES = { projects: 'projects', tasks: 'tasks' } as const
type Resource = keyof typeof TABLES

const MAX_BODY_BYTES = 100_000

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function error(status: number, message: string) {
  return json({ error: message }, status)
}

function isResource(name: string | undefined): name is Resource {
  return name !== undefined && Object.hasOwn(TABLES, name)
}

async function list(db: D1Database, resource: Resource) {
  const { results } = await db
    .prepare(`SELECT data FROM ${TABLES[resource]} ORDER BY created_at, id`)
    .all<{ data: string }>()
  return json(results.map((row) => JSON.parse(row.data)))
}

async function save(db: D1Database, resource: Resource, id: string, request: Request) {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return error(413, 'Body too large')

  let item: unknown
  try {
    item = JSON.parse(text)
  } catch {
    return error(400, 'Body must be JSON')
  }
  if (typeof item !== 'object' || item === null || (item as { id?: unknown }).id !== id) {
    return error(400, 'Body must be an object whose id matches the URL')
  }

  await db
    .prepare(
      `INSERT INTO ${TABLES[resource]} (id, data) VALUES (?1, ?2)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(id, JSON.stringify(item))
    .run()
  return json(item)
}

async function remove(db: D1Database, resource: Resource, id: string) {
  await db.prepare(`DELETE FROM ${TABLES[resource]} WHERE id = ?1`).bind(id).run()
  return new Response(null, { status: 204 })
}

export default {
  async fetch(request, env) {
    // e.g. "/api/tasks/abc" -> ["", "api", "tasks", "abc"]
    const [, api, resource, rawId, ...rest] = new URL(request.url).pathname.split('/')
    if (api !== 'api' || !isResource(resource) || rest.length > 0) return error(404, 'Not found')
    const id = rawId ? decodeURIComponent(rawId) : undefined

    try {
      if (!id && request.method === 'GET') return await list(env.DB, resource)
      if (id && request.method === 'PUT') return await save(env.DB, resource, id, request)
      if (id && request.method === 'DELETE') return await remove(env.DB, resource, id)
      return error(405, 'Method not allowed')
    } catch (e) {
      console.error(e)
      return error(500, 'Internal error')
    }
  },
} satisfies ExportedHandler<Env>
