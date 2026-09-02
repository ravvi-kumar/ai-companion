import { validateEnv } from './config/env.js';
import { ChatLoop } from './chat/chat-loop.js';

async function main() {
  try {
    validateEnv();
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  const chatLoop = new ChatLoop();

  process.on('SIGINT', () => {
    console.log('\n\nMaya: Bye for now! Stay safe.');
    chatLoop.close();
    process.exit(0);
  });

  try {
    await chatLoop.start();
  } catch (err: any) {
    console.error('Fatal error in companion chat loop:', err);
    chatLoop.close();
    process.exit(1);
  }
}

main();
