import { promises as fs } from "node:fs";
import path from "node:path";
import { apiEndpoints } from "../docs/endpoint-registry";
import {
  pathParameterExamples,
  queryParameterContracts,
  requestBodyContracts,
  requestBodySchemaContracts,
  successContracts,
} from "../docs/openapi-contracts";

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
    routeCount += [...source.matchAll(/router\.(get|post|put|patch|delete)\s*\(/g)].length;
  }

  const keys = apiEndpoints.map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.path}`);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);

  if (duplicates.length > 0) {
    throw new Error(`Duplicate endpoint documentation: ${[...new Set(duplicates)].join(", ")}`);
  }

  const endpointKeySet = new Set(keys);
  const successKeys = Object.keys(successContracts);
  const missingSuccessExamples = keys.filter((key) => !successContracts[key]);
  const extraSuccessExamples = successKeys.filter((key) => !endpointKeySet.has(key));
  if (missingSuccessExamples.length > 0 || extraSuccessExamples.length > 0) {
    throw new Error(
      `OpenAPI success-example drift. Missing: ${missingSuccessExamples.join(", ") || "none"}; extra: ${extraSuccessExamples.join(", ") || "none"}.`,
    );
  }

  const expectedBodyKeys = apiEndpoints
    .filter((endpoint) => endpoint.requestBody)
    .map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.path}`);
  const missingRequestBodies = expectedBodyKeys.filter((key) => !requestBodyContracts[key]);
  const extraRequestBodies = Object.keys(requestBodyContracts).filter(
    (key) => !expectedBodyKeys.includes(key),
  );
  if (missingRequestBodies.length > 0 || extraRequestBodies.length > 0) {
    throw new Error(
      `OpenAPI request-body drift. Missing: ${missingRequestBodies.join(", ") || "none"}; extra: ${extraRequestBodies.join(", ") || "none"}.`,
    );
  }

  const missingExplicitRequestSchemas = expectedBodyKeys.filter((key) => !requestBodySchemaContracts[key]);
  const extraExplicitRequestSchemas = Object.keys(requestBodySchemaContracts).filter(
    (key) => !expectedBodyKeys.includes(key),
  );
  if (missingExplicitRequestSchemas.length > 0 || extraExplicitRequestSchemas.length > 0) {
    throw new Error(
      `OpenAPI request-schema drift. Missing: ${missingExplicitRequestSchemas.join(", ") || "none"}; extra: ${extraExplicitRequestSchemas.join(", ") || "none"}.`,
    );
  }

  const invalidQueryContracts = Object.keys(queryParameterContracts).filter(
    (key) => !endpointKeySet.has(key),
  );
  if (invalidQueryContracts.length > 0) {
    throw new Error(`OpenAPI query contracts reference unknown routes: ${invalidQueryContracts.join(", ")}`);
  }
  const pathParameterNames = new Set(
    apiEndpoints.flatMap((endpoint) => [...endpoint.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)),
  );
  const missingPathParameterContracts = [...pathParameterNames].filter((name) => !pathParameterExamples[name]);
  if (missingPathParameterContracts.length > 0) {
    throw new Error(`OpenAPI path parameters missing schemas/examples: ${missingPathParameterContracts.join(", ")}`);
  }
  if (routeCount !== apiEndpoints.length) {
    throw new Error(
      `Route documentation drift: found ${routeCount} Express routes but ${apiEndpoints.length} API docs entries.`,
    );
  }

  process.stdout.write(`Documented ${apiEndpoints.length} API routes with explicit request schemas, enum contracts, and response examples across ${routeFiles.length} route files.\n`);
};

void main();
