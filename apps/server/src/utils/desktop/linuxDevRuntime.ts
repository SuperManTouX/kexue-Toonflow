import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { writeAtomic } from "@toonflow/file";
import type { DesktopRuntime } from "@/types/desktop";

async function selectPath(options: string[]) {
  const child = Bun.spawn(["zenity", "--file-selection", ...options], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, path] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  if (exitCode === 1) return null;
  if (exitCode !== 0) {
    const detail = await new Response(child.stderr).text();
    throw new Error(detail.trim() || "Linux 文件选择器启动失败");
  }
  return path.trim() || null;
}

function readClipboard(command: string[]) {
  try {
    return execFileSync(command[0]!, command.slice(1), { maxBuffer: 100 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function writeClipboard(command: string[], content: string | Uint8Array) {
  try {
    execFileSync(command[0]!, command.slice(1), { input: content, stdio: ["pipe", "ignore", "pipe"] });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Linux 剪贴板写入失败");
  }
}

function openWithSystem(path: string) {
  try {
    const child = Bun.spawn(["xdg-open", path], { stdout: "ignore", stderr: "ignore" });
    void child.exited.then(code => { if (code !== 0) console.error(`xdg-open 退出（${code}）`); }).catch(console.error);
  } catch (error) {
    console.error("Linux 无法打开外部链接：", error);
  }
}

export default function createLinuxDevRuntime(version: string): DesktopRuntime {
  const selectedFiles = new Map<string, string>();
  return {
    openUrl: openWithSystem,
    showItemInFolder: path => openWithSystem(dirname(path)),
    readClipboardText: () => readClipboard(["wl-paste", "--no-newline"])?.toString("utf8") ?? null,
    readClipboardImage: () => readClipboard(["wl-paste", "--type", "image/png"]) ?? null,
    writeClipboardImage: image => writeClipboard(["wl-copy", "--type", "image/png"], image),
    writeClipboardText: text => writeClipboard(["wl-copy"], text),
    async selectProviderFile() {
      return selectPath(["--title=选择提供方文件", "--file-filter=TypeScript | *.ts"]);
    },
    async selectDirectory() {
      return selectPath(["--directory", "--title=选择工作目录"]);
    },
    async selectSaveFile(fileName) {
      const path = await selectPath(["--save", "--confirm-overwrite", `--filename=${fileName}`, "--title=保存文件"]);
      if (!path) return null;
      const token = crypto.randomUUID();
      selectedFiles.set(token, path);
      return token;
    },
    async saveFile(token, content) {
      const path = selectedFiles.get(token);
      if (!path) return false;
      await writeAtomic(path, content);
      selectedFiles.delete(token);
      return true;
    },
    async ready() {},
    openDevTools() {
      throw new Error("请在浏览器中按 F12 打开开发者工具");
    },
    updater: {
      async getLocalInfo() {
        return { version, channel: "dev", hash: "linux-browser-dev", baseUrl: "" };
      },
      updateInfo: () => undefined,
      async checkForUpdate() { return {}; },
    },
  };
}
