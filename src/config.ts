import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

const ownerTelegramId = Number(required('OWNER_TELEGRAM_ID'));
if (!Number.isSafeInteger(ownerTelegramId) || ownerTelegramId <= 0) {
  throw new Error('OWNER_TELEGRAM_ID must be a positive Telegram numeric ID.');
}

export const config = {
  botToken: required('BOT_TOKEN'),
  ownerTelegramId: BigInt(ownerTelegramId),
  defaultTimezone: process.env.TIMEZONE?.trim() || 'Asia/Almaty',
  databaseUrl: required('DATABASE_URL'),
};
