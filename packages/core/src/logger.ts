import pino from "pino";

/** Structured logger with credential redaction. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["*.botToken", "*.accessToken", "*.refreshToken", "*.appPassword", "*.apiKey", "*.pageAccessToken", "*.userAccessToken", "*.password", "*.authorization", "headers.authorization", "credentials", "*.credentials"],
    censor: "[redacted]",
  },
  base: { service: process.env.SERVICE_NAME ?? "social-manager" },
});
