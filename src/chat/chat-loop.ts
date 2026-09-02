import readline from 'node:readline';
import { AppDatabase } from '../storage/database.js';
import { MessageRepository } from '../storage/messages.js';
import { MemoryRepository } from '../storage/memories.js';
import { MemoryExtractor } from '../memory/extractor.js';
import { MemoryResolver } from '../memory/resolver.js';
import { MemoryRetriever } from '../memory/retriever.js';
import { EmbeddingService } from '../llm/embeddings.js';
import { ContextBuilder } from './context-builder.js';
import { MAYA_PERSONA } from '../persona/persona.js';
import { PersonaPromptBuilder } from '../persona/prompt.js';
import { LLMClient, LLMMessage } from '../llm/client.js';

export interface ChatLoopConfig {
  db?: AppDatabase;
  llmClient?: LLMClient;
  sessionId?: string;
  embeddingService?: EmbeddingService;
}

export class ChatLoop {
  private db: AppDatabase;
  private messageRepo: MessageRepository;
  private memoryRepo: MemoryRepository;
  private memoryExtractor: MemoryExtractor;
  private memoryResolver: MemoryResolver;
  private memoryRetriever: MemoryRetriever;
  private embeddingService: EmbeddingService;
  private contextBuilder: ContextBuilder;
  private promptBuilder: PersonaPromptBuilder;
  private llmClient: LLMClient;
  private currentSessionId: string;
  private rl: readline.Interface | null = null;

  constructor(config: ChatLoopConfig = {}) {
    this.db = config.db || new AppDatabase();
    this.messageRepo = new MessageRepository(this.db.getRawDb());
    this.memoryRepo = new MemoryRepository(this.db.getRawDb());
    this.promptBuilder = new PersonaPromptBuilder(MAYA_PERSONA);
    this.llmClient = config.llmClient || new LLMClient();
    this.embeddingService = config.embeddingService || new EmbeddingService();
    this.memoryRetriever = new MemoryRetriever(this.memoryRepo, this.embeddingService);
    this.memoryExtractor = new MemoryExtractor(this.llmClient);
    this.memoryResolver = new MemoryResolver(this.memoryRepo, this.llmClient);
    this.contextBuilder = new ContextBuilder(MAYA_PERSONA);

    const session = this.messageRepo.getOrCreateSession(config.sessionId);
    this.currentSessionId = session.id;
  }

  public getSessionId(): string {
    return this.currentSessionId;
  }

  public async start(): Promise<void> {
    console.log('\n======================================================');
    console.log(`🌸  MAYA — AI Companion Interactive Chat Loop  🌸`);
    console.log('======================================================');
    console.log(`Session ID : ${this.currentSessionId}`);
    console.log(`Model      : ${this.llmClient.getModel()}`);
    console.log(`Commands   : /help, /memories, /history <key>, /session, /new, /exit\n`);

    // Greet user or acknowledge resumed session
    const existingMessages = this.messageRepo.getMessagesForSession(this.currentSessionId);
    if (existingMessages.length > 0) {
      console.log(`[Resumed session with ${existingMessages.length} prior message(s)]`);
      const lastFew = existingMessages.slice(-4);
      for (const msg of lastFew) {
        const prefix = msg.role === 'user' ? 'You' : 'Maya';
        console.log(`${prefix}: ${msg.content}`);
      }
      console.log('------------------------------------------------------\n');
    } else {
      console.log(`Maya: Hey there! It's lovely to meet you. How are you feeling today?\n`);
      this.messageRepo.saveMessage(
        this.currentSessionId,
        'assistant',
        "Hey there! It's lovely to meet you. How are you feeling today?"
      );
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'You > ',
      terminal: Boolean(process.stdin.isTTY)
    });

    this.rl.prompt();

    for await (const line of this.rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl.prompt();
        continue;
      }

      this.rl.pause();
      try {
        if (trimmed.startsWith('/')) {
          const shouldContinue = await this.handleCommand(trimmed);
          if (!shouldContinue) {
            break;
          }
        } else {
          process.stdout.write('\nMaya > ');
          await this.processUserMessage(trimmed, (chunk) => {
            process.stdout.write(chunk);
          });
          process.stdout.write('\n\n');
        }
      } finally {
        if (this.rl) {
          this.rl.resume();
          this.rl.prompt();
        }
      }
    }
  }

  public async processUserMessage(userInput: string, onToken?: (token: string) => void): Promise<string> {
    if (!onToken) {
      console.log(`\nUser > ${userInput}`);
    }

    // 1. Save user message to database
    const userMsgRecord = this.messageRepo.saveMessage(this.currentSessionId, 'user', userInput);

    // 2. Hybrid memory retrieval: retrieve top relevant active memories (safe fallback on error)
    let retrievedMemories: import('../memory/retriever.js').RankedMemory[] = [];
    try {
      retrievedMemories = await this.memoryRetriever.retrieve({
        query: userInput,
        subject: 'user',
        limit: 6
      });
    } catch (retrievalErr: any) {
      console.debug('[ChatLoop] Memory retrieval error, proceeding without memories:', retrievalErr.message);
      retrievedMemories = [];
    }

    // 3. Fetch recent conversation window for context (exclude current message to avoid duplication)
    const recentMsgs = this.messageRepo.getMessagesForSession(this.currentSessionId, 12);
    const priorMessages = recentMsgs.filter(m => m.id !== userMsgRecord.id).slice(-6);

    // 4. Assemble system prompt and message context via ContextBuilder
    const context = this.contextBuilder.buildContext({
      persona: MAYA_PERSONA,
      retrievedMemories,
      recentMessages: priorMessages.map(m => ({ role: m.role, content: m.content })),
      userMessage: userInput
    });

    // 5. Generate LLM response (streaming if token callback is provided)
    let response = '';
    if (onToken) {
      for await (const chunk of this.llmClient.stream({
        messages: context.messages,
        temperature: 0.7
      })) {
        response += chunk;
        onToken(chunk);
      }
    } else {
      response = await this.llmClient.generate({
        messages: context.messages,
        temperature: 0.7
      });
    }

    // 6. Save assistant response
    this.messageRepo.saveMessage(this.currentSessionId, 'assistant', response);

    // 7. Extract, resolve contradictions, compute embeddings, and store memories
    try {
      const candidates = await this.memoryExtractor.extract({
        userMessage: userInput,
        recentMessages: recentMsgs.map(m => ({ role: m.role, content: m.content }))
      });

      if (candidates.length > 0) {
        // Pre-compute embeddings for each candidate to store alongside the memory
        const embeddingsMap = new Map<string, number[]>();
        try {
          const texts = candidates.map(c => `[${c.memory_class}] [${c.type}] ${c.key}: ${c.value}`);
          const vectors = await this.embeddingService.getEmbeddings(texts);
          for (let i = 0; i < candidates.length; i++) {
            const key = `${candidates[i].key}:${candidates[i].value}`;
            if (vectors[i]) {
              embeddingsMap.set(key, vectors[i]);
            }
          }
        } catch (embErr: any) {
          console.debug('[ChatLoop] Embedding pre-computation failed, memories will be stored without embeddings:', embErr.message);
        }

        await this.memoryResolver.resolveCandidates(
          candidates,
          userInput,
          userMsgRecord.id,
          embeddingsMap
        );
      }
    } catch (err: any) {
      console.debug('[ChatLoop] Memory extraction/resolution error:', err.message);
    }

    if (!onToken) {
      console.log(`\nMaya > ${response}\n`);
    }

    return response;
  }

  private async handleCommand(commandLine: string): Promise<boolean> {
    const parts = commandLine.split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();

    switch (cmd) {
      case '/exit':
      case '/quit':
        console.log('\nMaya: Take care! It was wonderful talking to you. See you soon!\n');
        this.rl?.close();
        return false;

      case '/help':
        console.log('\n--- Available Commands ---');
        console.log('/help              : Show this help menu');
        console.log('/session           : Show current session details');
        console.log('/sessions          : List recent session IDs');
        console.log('/new               : Start a fresh session');
        console.log('/switch <id>       : Switch to an existing session');
        console.log('/clear             : Delete messages in current session');
        console.log('/memories          : Show all active user memories across 3 tiers');
        console.log('/history <key>     : Show evolution and status history of a memory key');
        console.log('/exit, /quit       : Exit the application\n');
        return true;

      case '/session': {
        const msgs = this.messageRepo.getMessagesForSession(this.currentSessionId);
        console.log(`\nSession Details:`);
        console.log(`ID: ${this.currentSessionId}`);
        console.log(`Total Messages: ${msgs.length}\n`);
        return true;
      }

      case '/sessions': {
        const recents = this.messageRepo.getRecentSessions(5);
        console.log('\nRecent Sessions:');
        recents.forEach(s => {
          console.log(`- ${s.id} (last active: ${s.last_active_at})`);
        });
        console.log('');
        return true;
      }

      case '/switch': {
        if (!arg) {
          console.log('\nUsage: /switch <session_id>\n');
          return true;
        }
        const session = this.messageRepo.getOrCreateSession(arg);
        this.currentSessionId = session.id;
        console.log(`\nSwitched to session: ${this.currentSessionId}\n`);
        return true;
      }

      case '/new': {
        const session = this.messageRepo.getOrCreateSession();
        this.currentSessionId = session.id;
        console.log(`\nStarted new session: ${this.currentSessionId}\n`);
        return true;
      }

      case '/clear': {
        this.messageRepo.clearSession(this.currentSessionId);
        console.log(`\nCleared session ${this.currentSessionId}.\n`);
        return true;
      }

      case '/memories': {
        const active = this.memoryRepo.getActiveMemories('user');
        const working = active.filter(m => m.memory_class === 'WORKING');
        const episodic = active.filter(m => m.memory_class === 'EPISODIC');
        const semantic = active.filter(m => !m.memory_class || m.memory_class === 'SEMANTIC');

        console.log(`\n================ ACTIVE USER MEMORIES (${active.length} total) ================`);

        console.log(`\n⚡ WORKING MEMORY (${working.length}) — [Immediate physical state & feelings]`);
        if (working.length === 0) {
          console.log('  (No active working memory items)');
        } else {
          for (const m of working) {
            const exp = m.expires_at ? ` | expires: ${m.expires_at.replace('T', ' ').slice(0, 19)}` : '';
            console.log(`  • [${m.type}] ${m.key} = "${m.value}"${exp}`);
          }
        }

        console.log(`\n📅 EPISODIC MEMORY (${episodic.length}) — [Recent events & temporary plans]`);
        if (episodic.length === 0) {
          console.log('  (No active episodic memory items)');
        } else {
          for (const m of episodic) {
            const exp = m.expires_at ? ` | expires: ${m.expires_at.replace('T', ' ').slice(0, 19)}` : '';
            console.log(`  • [${m.type}] ${m.key} = "${m.value}"${exp}`);
          }
        }

        console.log(`\n🧠 LONG-TERM SEMANTIC MEMORY (${semantic.length}) — [Durable personal facts]`);
        if (semantic.length === 0) {
          console.log('  (No long-term memories stored yet)');
        } else {
          for (const m of semantic) {
            console.log(`  • [${m.type}] ${m.key} = "${m.value}" (confidence: ${m.confidence.toFixed(2)}, importance: ${m.importance.toFixed(2)})`);
          }
        }

        console.log('===============================================================\n');
        return true;
      }

      case '/history': {
        if (!arg) {
          console.log('\nUsage: /history <key> (e.g. /history current_health_issue or /history employer)\n');
          return true;
        }
        const items = this.memoryRepo.getAllMemoriesByKey(arg, 'user');

        console.log(`\n=== 📜 LIFECYCLE HISTORY FOR "${arg.toLowerCase()}" (${items.length} records) ===`);
        if (items.length === 0) {
          console.log(`No records found for key "${arg}".`);
        } else {
          items.forEach((item, index) => {
            const statusBadge = item.status === 'ACTIVE'
              ? '🟢 [ACTIVE]'
              : item.status === 'SUPERSEDED'
              ? '🟡 [SUPERSEDED]'
              : item.status === 'EXPIRED'
              ? '⚪ [EXPIRED]'
              : '🔴 [DISCARDED]';

            console.log(`  ${index + 1}. ${statusBadge} [${item.memory_class}] "${item.value}"`);
            console.log(`     Type: ${item.type} | Created: ${item.created_at.replace('T', ' ').slice(0, 19)}`);
            if (item.expires_at) {
              console.log(`     Expires at: ${item.expires_at.replace('T', ' ').slice(0, 19)}`);
            }
            if (item.superseded_by) {
              console.log(`     ↳ Superseded by memory record: ${item.superseded_by}`);
            }
            if (index < items.length - 1) {
              console.log('         │ (state transition)');
              console.log('         ▼');
            }
          });
        }
        console.log('');
        return true;
      }

      default:
        console.log(`Unknown command "${cmd}". Type /help for assistance.\n`);
        return true;
    }
  }

  public close(): void {
    if (this.rl) {
      this.rl.close();
    }
    this.db.close();
  }
}
