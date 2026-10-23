import { mkdir, mkdtemp, readdir, writeAtomic } from "@toonflow/file";
import { defineConfig } from "@playwright/test";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const appDirectory = import.meta.dirname;
const e2ePortNames = ["TOONFLOW_E2E_WEB_PORT", "TOONFLOW_E2E_SERVER_PORT", "TOONFLOW_E2E_SXWZ_PORT"] as const;
const execFileAsync = promisify(execFile);

function parsePort(value: string | undefined) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

async function allocatePorts(count: number) {
  const servers = Array.from({ length: count }, () => createServer());
  try {
    for (const server of servers) await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    return servers.map(server => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("无法分配 Playwright E2E 端口");
      return address.port;
    });
  } finally {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  }
}

async function createTlsCertificate(directory: string) {
  const { stdout } = await execFileAsync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "-", "-out", "-",
    "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
  ], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  const output = String(stdout);
  const certificate = output.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
  const privateKey = output.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)?.[0];
  if (!certificate || !privateKey) throw new Error("无法为 SXWZ E2E 结果桩生成 TLS 证书");
  const certificatePath = join(directory, "e2eCertificate.pem");
  const privateKeyPath = join(directory, "e2ePrivateKey.pem");
  await Promise.all([
    writeAtomic(certificatePath, `${certificate}\n`, { exclusive: true, mode: 0o600 }),
    writeAtomic(privateKeyPath, `${privateKey}\n`, { exclusive: true, mode: 0o600 }),
  ]);
  return { certificatePath, privateKeyPath };
}

const listOnly = process.argv.includes("--list");
if (!listOnly) {
  const nodePackages = await readdir(join(appDirectory, "packages/nodes"), { withFileTypes: true });
  for (const nodePackage of nodePackages.filter(entry => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    await execFileAsync("bun", ["run", "--cwd", `packages/nodes/${nodePackage.name}`, "build"], {
      cwd: appDirectory,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
  }
}
const inheritedRun = !!process.env.TOONFLOW_E2E_TEMP_DIRECTORY
  && !!process.env.TOONFLOW_E2E_DATA_DIRECTORY
  && !!process.env.TOONFLOW_E2E_WORKSPACE_DIRECTORY
  && !!process.env.TOONFLOW_E2E_TLS_CERT_PATH
  && !!process.env.TOONFLOW_E2E_TLS_KEY_PATH
  && e2ePortNames.every(name => parsePort(process.env[name]) !== undefined);
const temporaryDirectory = listOnly ? "" : inheritedRun ? process.env.TOONFLOW_E2E_TEMP_DIRECTORY! : await mkdtemp(join(tmpdir(), "toonflow-e2e-"));
const dataDirectory = listOnly ? "data" : inheritedRun ? process.env.TOONFLOW_E2E_DATA_DIRECTORY! : join(temporaryDirectory, "data");
const workspaceDirectory = listOnly ? "workspace" : inheritedRun ? process.env.TOONFLOW_E2E_WORKSPACE_DIRECTORY! : join(dataDirectory, "workspaces", "linuxDevWorkspace");
if (!listOnly && !inheritedRun) await Promise.all([mkdir(dataDirectory), mkdir(workspaceDirectory, { recursive: true })]);
const { certificatePath, privateKeyPath } = listOnly ? { certificatePath: "", privateKeyPath: "" }
  : inheritedRun ? { certificatePath: process.env.TOONFLOW_E2E_TLS_CERT_PATH!, privateKeyPath: process.env.TOONFLOW_E2E_TLS_KEY_PATH! }
    : await createTlsCertificate(temporaryDirectory);
const [webPort, serverPort, sxwzPort] = inheritedRun
  ? e2ePortNames.map(name => parsePort(process.env[name])!) as [number, number, number]
  : await allocatePorts(3);
const sxwzBaseUrl = `http://127.0.0.1:${sxwzPort}`;

if (!listOnly) Object.assign(process.env, {
  TOONFLOW_E2E_TEMP_DIRECTORY: temporaryDirectory,
  TOONFLOW_E2E_DATA_DIRECTORY: dataDirectory,
  TOONFLOW_E2E_WORKSPACE_DIRECTORY: workspaceDirectory,
  TOONFLOW_E2E_WEB_PORT: String(webPort),
  TOONFLOW_E2E_SERVER_PORT: String(serverPort),
  TOONFLOW_E2E_SXWZ_PORT: String(sxwzPort),
  TOONFLOW_E2E_TLS_CERT_PATH: certificatePath,
  TOONFLOW_E2E_TLS_KEY_PATH: privateKeyPath,
});

const environment = {
  ...process.env,
  TOONFLOW_DEV_WEB_PORT: String(webPort),
  TOONFLOW_DEV_SERVER_PORT: String(serverPort),
  TOONFLOW_DEV_STRICT_PORT: "1",
  TOONFLOW_DEV_WEB_OPEN: "0",
  TOONFLOW_DEV_WORKSPACE_DIR: workspaceDirectory,
  TOONFLOW_DATA_DIR: dataDirectory,
  SXWZ_BASE_URL: sxwzBaseUrl,
  TOONFLOW_E2E_TLS_CERT_PATH: certificatePath,
  TOONFLOW_E2E_TLS_KEY_PATH: privateKeyPath,
  NODE_EXTRA_CA_CERTS: certificatePath,
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  globalSetup: "./e2e/e2eGlobalSetup.ts",
  globalTeardown: "./e2e/e2eGlobalTeardown.ts",
  metadata: {
    ...(listOnly ? {} : {
      temporaryDirectory,
      dataDirectory,
      workspaceDirectory,
    }),
    sxwzBaseUrl,
    webPort,
  },
  use: {
    baseURL: `http://127.0.0.1:${webPort}/?desktop=1&linuxDevWorkspace=1`,
    browserName: "chromium",
    locale: "zh-CN",
    viewport: { width: 1600, height: 1600 },
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun e2e/sxwzStubServer.ts",
      cwd: appDirectory,
      url: `${sxwzBaseUrl}/__e2e/health`,
      env: { ...environment, TOONFLOW_E2E_SXWZ_PORT: String(sxwzPort) },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "bun run dev",
      cwd: appDirectory,
      url: `http://127.0.0.1:${webPort}/`,
      env: environment,
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
});
