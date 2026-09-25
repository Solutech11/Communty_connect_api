import { spawn } from "node:child_process";
import { once } from "node:events";

const testFiles = [
  "tests/admin-views.test.ts",
  "tests/api-gap-contracts.test.ts",
  "tests/charges.test.ts",
  "tests/crypto.test.ts",
  "tests/docs.test.ts",
  "tests/recommendation.test.ts",
  "tests/security.test.ts",
  "tests/location.test.ts",
  "tests/location-search.test.ts",
  "tests/event-moderation.test.ts",
  "tests/request-body-log.test.ts",
];

const runTestFile = async (testFile: string): Promise<void> => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", testFile],
    { stdio: "inherit" },
  );
  const [exitCode] = await once(child, "exit") as [number | null];

  if (exitCode !== 0) {
    throw new Error(`Test failed: ${testFile}`);
  }
};

const main = async (): Promise<void> => {
  for (const testFile of testFiles) {
    await runTestFile(testFile);
  }
};

void main().then(() => {
  process.exit(0);
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Test runner failed"}\n`);
  process.exit(1);
});
