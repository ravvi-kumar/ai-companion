import { Persona } from '../persona/persona.js';
import { PersonaPromptBuilder } from '../persona/prompt.js';
import { RankedMemory } from '../memory/retriever.js';
import { LLMMessage } from '../llm/client.js';

export interface ContextBuilderOptions {
  persona: Persona;
  retrievedMemories: RankedMemory[];
  recentMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  userMessage: string;
}

export class ContextBuilder {
  private promptBuilder: PersonaPromptBuilder;

  constructor(persona: Persona) {
    this.promptBuilder = new PersonaPromptBuilder(persona);
  }

  public buildContext(options: ContextBuilderOptions): {
    systemPrompt: string;
    messages: LLMMessage[];
  } {
    const { persona, retrievedMemories, recentMessages, userMessage } = options;

    const formattedMemories = retrievedMemories.map(rm => ({
      type: rm.memory.type,
      memory_class: rm.memory.memory_class,
      key: rm.memory.key,
      value: rm.memory.value,
      importance: rm.memory.importance
    }));

    const systemPrompt = this.promptBuilder.buildFullPrompt({
      persona,
      memories: formattedMemories,
      recentMessages,
      userMessage
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...recentMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
      { role: 'user', content: userMessage }
    ];

    return { systemPrompt, messages };
  }
}
