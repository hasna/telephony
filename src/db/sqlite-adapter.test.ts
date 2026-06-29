import { afterEach, describe, expect, it } from "bun:test";
import { SqliteAdapter } from "./sqlite-adapter.js";

let db: SqliteAdapter | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("SqliteAdapter", () => {
  it("supports varargs and array parameter binding", () => {
    db = new SqliteAdapter(":memory:");
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");

    const first = db.run("INSERT INTO items (name) VALUES (?)", "alpha");
    const second = db.run("INSERT INTO items (name) VALUES (?)", ["beta"]);

    expect(first.changes).toBe(1);
    expect(second.changes).toBe(1);
    expect(Number(first.lastInsertRowid)).toBe(1);
    expect(Number(second.lastInsertRowid)).toBe(2);

    expect(db.get("SELECT name FROM items WHERE id = ?", [1])).toEqual({ name: "alpha" });
    expect(db.all("SELECT name FROM items WHERE name LIKE ? ORDER BY id", ["b%"])).toEqual([{ name: "beta" }]);
    expect(db.prepare("SELECT name FROM items ORDER BY id").all()).toEqual([{ name: "alpha" }, { name: "beta" }]);
  });

  it("enables SQLite foreign key enforcement by default", () => {
    db = new SqliteAdapter(":memory:");
    expect(db.get("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });

    db.exec(`
      CREATE TABLE parents (id TEXT PRIMARY KEY);
      CREATE TABLE children (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES parents(id) ON DELETE SET NULL
      );
    `);

    db.run("INSERT INTO parents (id) VALUES (?)", "parent-1");
    db.run("INSERT INTO children (id, parent_id) VALUES (?, ?)", "child-1", "parent-1");
    db.run("DELETE FROM parents WHERE id = ?", "parent-1");

    expect(db.get("SELECT parent_id FROM children WHERE id = ?", "child-1")).toEqual({ parent_id: null });
  });
});
