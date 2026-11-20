import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIRECTORY = path.resolve(CURRENT_DIR, "../../logs");
const PRIMARY_LOG_PATH = path.join(LOG_DIRECTORY, "execution.log");
const MAX_LOG_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

class DiagnosticLogger {
  constructor() {
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(LOG_DIRECTORY)) {
      fs.mkdirSync(LOG_DIRECTORY, { recursive: true });
    }
  }

  checkAndRotateLog() {
    try {
      if (fs.existsSync(PRIMARY_LOG_PATH)) {
        const stats = fs.statSync(PRIMARY_LOG_PATH);
        if (stats.size >= MAX_LOG_SIZE_BYTES) {
          const archivePath = path.join(
            LOG_DIRECTORY,
            `execution-${Date.now()}.log`
          );
          fs.renameSync(PRIMARY_LOG_PATH, archivePath);
        }
      }
    } catch (rotationError) {
      console.error("Log rotation error:", rotationError.message);
    }
  }

  writeRecord(record) {
    try {
      this.checkAndRotateLog();
      const serializedLine = JSON.stringify(record) + "\n";
      // appendFileSync guarantees that even if a fatal crash or SIGTERM occurs,
      // the breakpoint is persisted to disk immediately.
      fs.appendFileSync(PRIMARY_LOG_PATH, serializedLine, "utf8");
    } catch (writeError) {
      console.error("Diagnostic log append error:", writeError.message);
    }

    this.printConsoleNotification(record);
  }

  printConsoleNotification(record) {
    const timestampShort = record.timestamp.split("T")[1]?.slice(0, 8) || record.timestamp;
    const shortTrace = record.traceId.slice(-6);
    const durationTag = record.durationMs !== undefined ? ` +${record.durationMs}ms` : "";

    switch (record.status) {
      case "BREAKPOINT": {
        const errorDetail = record.error
          ? ` -> ${record.error.name}: ${record.error.message}`
          : record.message || "";
        console.error(
          `${ANSI.red}${ANSI.bold}[BREAKPOINT]${ANSI.reset} ` +
          `${ANSI.dim}${timestampShort}${ANSI.reset} ` +
          `(${ANSI.magenta}${shortTrace}${ANSI.reset}) ` +
          `[${ANSI.yellow}${record.stage}${ANSI.reset}]` +
          `${ANSI.red}${durationTag}${errorDetail}${ANSI.reset}`
        );
        break;
      }

      case "WARN": {
        console.warn(
          `${ANSI.yellow}${ANSI.bold}[WARN]${ANSI.reset} ` +
          `${ANSI.dim}${timestampShort}${ANSI.reset} ` +
          `(${ANSI.magenta}${shortTrace}${ANSI.reset}) ` +
          `[${record.stage}]${durationTag} ` +
          `${record.message || ""}`
        );
        break;
      }

      default: {
        const stageColor = record.stage === "INGRESS" || record.stage === "EGRESS"
          ? ANSI.cyan
          : ANSI.green;
        console.log(
          `${stageColor}[TRACE]${ANSI.reset} ` +
          `${ANSI.dim}${timestampShort}${ANSI.reset} ` +
          `(${ANSI.magenta}${shortTrace}${ANSI.reset}) ` +
          `[${record.stage}]` +
          `${ANSI.gray}${durationTag}${ANSI.reset} ` +
          `${record.message || ""}`
        );
        break;
      }
    }
  }
}

export const diagnosticLogger = new DiagnosticLogger();
export { PRIMARY_LOG_PATH };
