// utils contains small shared helpers used across the backend.
// This logger can later be replaced with a production logger such as pino or winston.
export const logger = {
  info: (...messages) => console.log(...messages),
  error: (...messages) => console.error(...messages),
};
