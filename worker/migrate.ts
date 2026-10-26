// Creates and updates the tables from the SQL files in migrations/, so a new database
// works on the Worker's first request without running `wrangler d1 migrations apply` first.
// Applied files are recorded in d1_migrations, the same table wrangler uses, so either
// can apply a migration and the other will skip it.
/// <reference types="vite/client" />

// Bundled in by Vite, keyed by path, e.g. "../migrations/0001_create_projects_and_tasks.sql"
const FILES = import.meta.glob<string>('../migrations/*.sql', { query: '?raw', import: 'default', eager: true })

// Splits a file into statements, which must each end with a semicolon at the end of a line
const statements = (sql: string) =>
  sql.split(/;\s*$/m).filter((statement) => statement.replace(/--.*$/gm, '').trim() !== '')

// Applies the files the database doesn't have yet, in filename order
export async function migrate(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    )
    .run()
  const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()
  const applied = new Set(results.map((row) => row.name))

  for (const [path, sql] of Object.entries(FILES).sort(([a], [b]) => a.localeCompare(b))) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (applied.has(name)) continue
    try {
      // One transaction, so a file is either fully applied and recorded, or not at all
      await db.batch([
        ...statements(sql).map((statement) => db.prepare(statement)),
        db.prepare('INSERT INTO d1_migrations (name) VALUES (?1)').bind(name),
      ])
    } catch (e) {
      // Fine if another request applied it at the same time
      const done = await db.prepare('SELECT 1 FROM d1_migrations WHERE name = ?1').bind(name).first()
      if (!done) throw e
    }
  }
}

let migrated: Promise<void> | undefined

// Runs migrate once per Worker instance, trying again on the next request if it fails
export function migrateOnce(db: D1Database) {
  migrated ??= migrate(db).catch((e) => {
    migrated = undefined
    throw e
  })
  return migrated
}
