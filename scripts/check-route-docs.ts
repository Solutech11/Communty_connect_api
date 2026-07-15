import { promises as fs } from "node:fs";
import path from "node:path";
import { apiEndpoints } from "../docs/endpoint-registry";

const routeRoot = path.resolve(process.cwd(), "router");

const collectRouteFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRouteFiles(fullPath)));
    } else if (entry.name.endsWith(".route.ts")) {
      files.push(fullPath);
    }
  }

  return files;
};

const main = async (): Promise<void> => {
  const routeFiles = await collectRouteFiles(routeRoot);
  let routeCount = 0;

  for (const file of routeFiles) {
    const source = await fs.readFile(file, "utf8");
    routeCount += [...source.matchAll(/router\.(get|post|patch|delete)\s*\(/g)].length;
  }

  const keys = apiEndpoints.map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.path}`);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);

  if (duplicates.length > 0) {
    throw new Error(`Duplicate endpoint documentation: ${[...new Set(duplicates)].join(", ")}`);
  }

  if (routeCount !== apiEndpoints.length) {
    throw new Error(
      `Route documentation drift: found ${routeCount} Express routes but ${apiEndpoints.length} API docs entries.`,
    );
  }

  process.stdout.write(`Documented ${apiEndpoints.length} API routes across ${routeFiles.length} route files.\n`);
};

void main();
