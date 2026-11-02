import { startBot } from './bot';
import { prisma } from './db';

startBot().catch(async (error) => {
  console.error('Bot failed to start:', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
