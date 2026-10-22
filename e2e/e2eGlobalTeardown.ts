import { rm } from "@toonflow/file";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { FullConfig } from "@playwright/test";

export default async function e2eGlobalTeardown(config: FullConfig) {
  const temporaryDirectory = config.metadata.temporaryDirectory;
  if (typeof temporaryDirectory !== "string" || !temporaryDirectory) return;
  const resolvedDirectory = resolve(temporaryDirectory);
  if (dirname(resolvedDirectory) !== tmpdir() || !basename(resolvedDirectory).startsWith("toonflow-e2e-")) return;
  await rm(resolvedDirectory, { recursive: true, force: true });
}
