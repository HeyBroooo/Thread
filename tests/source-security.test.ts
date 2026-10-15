import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiskSourceRegistry } from "@cbi/shared";
import { buildInventory } from "../packages/parser/src/inventory";
import { readProjectManifest } from "../apps/api/src/manifests";
describe("checkout filesystem boundaries", () => {
  it("does not read through symlinked directories or traverse workspace manifests outside the checkout", () => {
    const temp = mkdtempSync(join(tmpdir(), "checkout-boundary-")),
      repo = join(temp, "repo"),
      outside = join(temp, "private");
    try {
      mkdirSync(repo);
      mkdirSync(outside);
      writeFileSync(
        join(outside, "secret.ts"),
        'export const secret = "private-data";',
      );
      writeFileSync(
        join(outside, "package.json"),
        JSON.stringify({ name: "private-package" }),
      );
      writeFileSync(
        join(repo, "package.json"),
        JSON.stringify({
          name: "safe-repo",
          workspaces: ["../private", "../*", "linked"],
        }),
      );
      symlinkSync(outside, join(repo, "linked"), "junction");
      const registry = new DiskSourceRegistry(repo);
      expect(registry.getFileContent("../private/secret.ts")).toBeNull();
      expect(registry.getFileContent("linked/secret.ts")).toBeNull();
      expect(
        buildInventory(repo).files.some((file) =>
          file.filePath.includes("secret.ts"),
        ),
      ).toBe(false);
      expect(readProjectManifest(repo).workspaces).toEqual([]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
