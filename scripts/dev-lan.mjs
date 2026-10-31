import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";

// 仅允许本机实际网卡对应的开发入口，不以通配符放宽 API 校验。
const addresses = [...new Set(Object.values(networkInterfaces()).flat()
  .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry.address))];
const origins = addresses.map((address) => `http://${address}:5190`);
console.log("本机热更新地址：http://127.0.0.1:5190");
if (origins.length) console.log(`局域网热更新地址：\n${origins.join("\n")}`);
else console.log("未检测到局域网 IPv4 地址，当前可通过本机地址访问。");
const child = spawn("npm", ["exec", "--", "concurrently", "-k", "-n", "api,web", "npm:dev:api", "npm:dev:web"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "development",
    TVBOX_HOST: "127.0.0.1",
    TVBOX_PORT: "4781",
    TVBOX_DEV_HOST: "0.0.0.0",
    TVBOX_ORIGINS: origins.join(","),
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
