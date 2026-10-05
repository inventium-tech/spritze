import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { generateNotes } from "@semantic-release/release-notes-generator";
import releaseConfig from "../.releaserc.json";

test("release notes render with the installed preset and repository configuration", async () => {
  const [, pluginConfig] = releaseConfig.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/release-notes-generator",
  );
  const notes = await generateNotes(pluginConfig, {
    cwd: resolve(import.meta.dir, ".."),
    options: { repositoryUrl: "https://github.com/inventium-tech/spritze.git" },
    lastRelease: { gitTag: "v1.0.0" },
    nextRelease: { version: "1.0.1", gitTag: "v1.0.1" },
    commits: [
      { hash: "a".repeat(40), message: "chore(deps): update libraries and remove TypeScript peer dependency" },
      { hash: "b".repeat(40), message: "ci: pin GitHub Actions to latest releases" },
      { hash: "c".repeat(40), message: "fix: restore release notes generation" },
    ],
  });

  expect(notes).toContain("1.0.1");
  expect(notes).toContain("Chores");
  expect(notes).toContain("update libraries and remove TypeScript peer dependency");
  expect(notes).toContain("Bug Fixes");
  expect(notes).toContain("restore release notes generation");
  expect(notes).not.toContain("pin GitHub Actions");
  expect(notes).toContain("https://github.com/inventium-tech/spritze/compare/v1.0.0...v1.0.1");
});
