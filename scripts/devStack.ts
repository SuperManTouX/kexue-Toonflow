import { resolve } from "node:path";

if (!process.env.EXTERNAL_TOKEN_VERIFICATION_URL) {
  console.error("请先设置 EXTERNAL_TOKEN_VERIFICATION_URL（可写入仓库根目录 .env），再启动 SXWZ 开发服务。");
  process.exit(1);
}

const services = [
  { name: "Web", directory: resolve(import.meta.dirname, "../apps/web") },
  { name: "Server", directory: resolve(import.meta.dirname, "../apps/server") },
];
const processes = services.map(service => ({
  ...service,
  process: Bun.spawn([process.execPath, "run", "--no-orphans", "dev"], {
    cwd: service.directory,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
}));

let stopping = false;
let requestStop: (exitCode: number) => void;
const stopped = new Promise<number>(resolveStop => { requestStop = resolveStop; });

async function stopStack(exitCode: number) {
  if (stopping) return;
  stopping = true;
  const forceStop = setTimeout(() => {
    for (const child of processes) if (child.process.exitCode === null) child.process.kill("SIGKILL");
  }, 5000);
  forceStop.unref();
  for (const child of processes) if (child.process.exitCode === null) child.process.kill("SIGTERM");
  await Promise.all(processes.map(child => child.process.exited));
  clearTimeout(forceStop);
  requestStop(exitCode);
}

process.once("SIGINT", () => { void stopStack(130); });
process.once("SIGTERM", () => { void stopStack(143); });
for (const child of processes) {
  void child.process.exited.then(exitCode => {
    if (stopping) return;
    console.error(`${child.name} 开发服务已退出（${exitCode}），正在停止整个开发栈。`);
    void stopStack(exitCode);
  });
}

process.exitCode = await stopped;
