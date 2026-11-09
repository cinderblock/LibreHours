import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveDatabasePath } from "./database-path.ts";

const files = (...present: string[]) => (path: string) => present.includes(path);

describe("resolveDatabasePath", () => {
  test("defaults to ./data/librehours.db", () => {
    expect(resolveDatabasePath(undefined, files())).toEqual({
      path: join(".", "data", "librehours.db"),
      legacy: false,
    });
  });

  test("keeps using time-tracker.db when it is the only file there", () => {
    expect(resolveDatabasePath("/data/librehours.db", files(join("/data", "time-tracker.db")))).toEqual({
      path: join("/data", "time-tracker.db"),
      legacy: true,
    });
  });

  test("prefers librehours.db once it exists", () => {
    const both = files("/data/librehours.db", join("/data", "time-tracker.db"));
    expect(resolveDatabasePath("/data/librehours.db", both)).toEqual({ path: "/data/librehours.db", legacy: false });
  });

  test("takes any other path as given", () => {
    const old = files(join("/srv", "time-tracker.db"));
    expect(resolveDatabasePath("/srv/books.db", old)).toEqual({ path: "/srv/books.db", legacy: false });
    expect(resolveDatabasePath("/data/time-tracker.db", files())).toEqual({
      path: "/data/time-tracker.db",
      legacy: false,
    });
  });
});
