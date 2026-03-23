import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { CreateProjectInput, Project } from "../types/index.js";
import { ProjectNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function createProject(input: CreateProjectInput, db?: Database): Project {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO projects (id, name, path, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.path, input.description || null, timestamp, timestamp],
  );

  return getProject(id, d)!;
}

export function getProject(id: string, db?: Database): Project | null {
  const d = db || getDatabase();
  return d.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | null;
}

export function getProjectByPath(path: string, db?: Database): Project | null {
  const d = db || getDatabase();
  return d.prepare("SELECT * FROM projects WHERE path = ?").get(path) as Project | null;
}

export function listProjects(db?: Database): Project[] {
  const d = db || getDatabase();
  return d.prepare("SELECT * FROM projects ORDER BY name").all() as Project[];
}

export function updateProject(
  id: string,
  input: Partial<Pick<Project, "name" | "description">>,
  db?: Database,
): Project {
  const d = db || getDatabase();
  const project = getProject(id, d);
  if (!project) throw new ProjectNotFoundError(id);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }

  if (sets.length > 0) {
    sets.push("updated_at = ?");
    params.push(now());
    params.push(id);
    d.run(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  return getProject(id, d)!;
}

export function deleteProject(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM projects WHERE id = ?", [id]).changes > 0;
}
