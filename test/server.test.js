import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function runServerWithInput(lines) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverPath = path.resolve(__dirname, "..", "src", "server.js");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`server exited ${code}: ${stderr}`));
      const outLines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      resolve(outLines.map((l) => JSON.parse(l)));
    });

    child.stdin.write(lines.join("\n") + "\n");
    child.stdin.end();
  });
}

test("initialize negotiates protocolVersion when client requests unknown version", async () => {
  const responses = await runServerWithInput([
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2099-01-01",
        capabilities: {},
        clientInfo: { name: "unit", version: "0" }
      }
    })
  ]);

  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, 1);
  assert.ok(responses[0].result);
  assert.equal(responses[0].result.protocolVersion, "2025-06-18");
});

