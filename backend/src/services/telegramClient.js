// Backward-compatible re-export.
// New Telegram workflows should import from telegramService.js.
export {
  createTelegramClient,
  getTelegramClient,
} from "./telegramService.js";
