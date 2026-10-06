import { describe, expect, it } from 'vitest';
import { CodebaseChat, generateStructured, type AIProvider, type AIRequest, type AIResult } from '@cbi/ai';
import { ChatAnswerSchema } from '@cbi/ai';
import { SearchService } from '@cbi/search';
import { DiskSourceRegistry } from '@cbi/shared';
import { FIXTURE_ROOT, indexFixture } from './helpers.js';

class FakeProvider implements AIProvider {
  readonly id = 'fake';
  readonly defaultModel = 'fake-model';
  calls = 0;
  constructor(private responder: (request: AIRequest) => string) {}
  async complete(request: AIRequest): Promise<AIResult> {
    this.calls++;
    return { text: this.responder(request), model: this.defaultModel, usage: { totalTokens: 10 } };
  }
}

const VALID_CHAT = JSON.stringify({
  answer: 'Discharge starts in DischargeButton.',
  references: [{ file: 'src/components/patient/DischargeButton.tsx', startLine: 9, endLine: 11, symbol: 'DischargeButton' }],
  relationships: [{ from: 'DischargeButton', relationship: 'CALLS', to: 'dischargePatient' }],
  confidence: 0.9,
});

describe('structured generation', () => {
  it('parses a valid structured response', async () => {
    const provider = new FakeProvider(() => VALID_CHAT);
    const { data } = await generateStructured(
      provider,
      { system: 's', context: 'c', user: 'u' },
      { schema: ChatAnswerSchema },
    );
    expect(data.answer).toContain('DischargeButton');
    expect(data.references).toHaveLength(1);
  });

  it('recovers JSON wrapped in a fenced code block', async () => {
    const provider = new FakeProvider(() => '```json\n' + VALID_CHAT + '\n```');
    const { data } = await generateStructured(provider, { system: 's', context: 'c', user: 'u' }, { schema: ChatAnswerSchema });
    expect(data.confidence).toBeCloseTo(0.9);
  });

  it('rejects a response with no JSON at all', async () => {
    const provider = new FakeProvider(() => 'I cannot answer that.');
    await expect(
      generateStructured(provider, { system: 's', context: 'c', user: 'u' }, { schema: ChatAnswerSchema }),
    ).rejects.toThrow(/did not contain JSON/);
  });

  it('rejects a response that does not match the schema', async () => {
    const provider = new FakeProvider(() => JSON.stringify({ answer: 'x', confidence: 5 }));
    await expect(
      generateStructured(provider, { system: 's', context: 'c', user: 'u' }, { schema: ChatAnswerSchema }),
    ).rejects.toThrow(/schema/);
  });
});

describe('chat grounding', () => {
  async function chatWith(responder: (req: AIRequest) => string) {
    const { store, repositoryId } = await indexFixture();
    const provider = new FakeProvider(responder);
    const chat = new CodebaseChat({
      store,
      search: new SearchService(store),
      sources: new DiskSourceRegistry(FIXTURE_ROOT),
      provider,
    });
    return chat.ask(repositoryId, 'Where does patient discharge happen?');
  }

  it('keeps references that exist in the indexed graph', async () => {
    const answer = await chatWith(() => VALID_CHAT);
    expect(answer.references).toHaveLength(1);
    expect(answer.references[0]!.filePath).toBe('src/components/patient/DischargeButton.tsx');
    expect(answer.references[0]!.snippet).toContain('DischargeButton');
  });

  it('rejects hallucinated file references and marks the answer unverified', async () => {
    const answer = await chatWith(() =>
      JSON.stringify({
        answer: 'It is in FakeComponent.',
        references: [{ file: 'src/components/patient/FakeComponent.tsx', startLine: 1, endLine: 5, symbol: 'FakeComponent' }],
        relationships: [],
        confidence: 0.95,
      }),
    );
    expect(answer.references).toHaveLength(0);
    expect(answer.unverified).toBe(true);
    expect(answer.confidence).toBeLessThanOrEqual(0.3);
    expect(answer.answer).toMatch(/could not be fully verified/i);
  });

  it('clamps an out-of-range line instead of trusting the model', async () => {
    const answer = await chatWith(() =>
      JSON.stringify({
        answer: 'See the component.',
        references: [{ file: 'src/hooks/usePatient.ts', startLine: 5000, endLine: 6000, symbol: 'usePatient' }],
        relationships: [],
        confidence: 0.7,
      }),
    );
    expect(answer.references).toHaveLength(1);
    const ref = answer.references[0]!;
    expect(ref.startLine).toBeLessThan(5000);
    expect(ref.endLine).toBeGreaterThanOrEqual(ref.startLine);
  });

  it('labels answers when the graph is only partially indexed', async () => {
    const { store, repositoryId } = await indexFixture();
    const provider = new FakeProvider(() => VALID_CHAT);
    const chat = new CodebaseChat({
      store,
      search: new SearchService(store),
      sources: new DiskSourceRegistry(FIXTURE_ROOT),
      provider,
    });
    const answer = await chat.ask(repositoryId, 'Where does patient discharge happen?', { partialGraph: true });
    expect(answer.partial).toBe(true);
    expect(answer.answer).toMatch(/still being built/i);
  });
});
