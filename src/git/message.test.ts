import { catchErr } from '../../test/helpers/catch.ts';
import { formatCommitMessage, parseCommitMessage } from './message.ts';

const OP_JSON = '{"op":"issue.move","id":"bk-7f3k2","to":"review"}';
const OP1 = '{"op":"issue.create","id":"bk-aaaaa"}';
const OP2 = '{"op":"issue.create","id":"bk-bbbbb"}';

describe('formatCommitMessage', () => {
  test('a single op message', () =>
    expect(
      formatCommitMessage({
        subject: 'issue move bk-7f3k2 review',
        trailers: [
          ['Backe-Actor', 'claude-1'],
          ['Backe-Op', OP_JSON],
        ],
      }),
    ).toBe(`issue move bk-7f3k2 review\n\nBacke-Actor: claude-1\nBacke-Op: ${OP_JSON}\n`));

  test('a body is placed between subject and trailers without trailing newlines', () =>
    expect(
      formatCommitMessage({ subject: 's', body: 'text\n\n', trailers: [['Backe-Op', 'batch']] }),
    ).toBe('s\n\ntext\n\nBacke-Op: batch\n'));

  test('an empty or multi-line subject is rejected', () => {
    expect(catchErr(() => formatCommitMessage({ subject: '', trailers: [] })).code).toBe(
      'unexpected',
    );
    expect(catchErr(() => formatCommitMessage({ subject: 'a\nb', trailers: [] })).code).toBe(
      'unexpected',
    );
  });

  test('a trailer value with a line break is rejected', () =>
    expect(
      catchErr(() => formatCommitMessage({ subject: 's', trailers: [['Backe-Op', 'a\nb']] })).code,
    ).toBe('unexpected'));
});

describe('parseCommitMessage', () => {
  test('a batch body survives the round trip and is not taken for trailers', () => {
    const m = {
      subject: 'batch: 2 create',
      body: `${OP1}\n${OP2}\n`,
      trailers: [
        ['Backe-Actor', 'spw'],
        ['Backe-Op', 'batch'],
      ],
    } as const;
    const parsed = parseCommitMessage(formatCommitMessage(m));
    expect(parsed.subject).toBe('batch: 2 create');
    expect(parsed.body).toBe(`${OP1}\n${OP2}`);
    expect(parsed.trailers.get('Backe-Op')).toEqual(['batch']);
    expect(parsed.trailers.get('Backe-Actor')).toEqual(['spw']);
  });

  test('a message without trailer paragraph has no trailers', () => {
    const parsed = parseCommitMessage('fix\n\nsome text\n');
    expect(parsed.trailers.size).toBe(0);
    expect(parsed.body).toBe('some text');
  });

  test('a subject-only message has neither body nor trailers', () => {
    const parsed = parseCommitMessage('fix\n');
    expect(parsed).toEqual({ subject: 'fix', body: undefined, trailers: new Map() });
  });

  test('a mixed last paragraph is no trailer paragraph', () =>
    expect(parseCommitMessage('x\n\nBacke-Actor: a\nnot a trailer\n').trailers.size).toBe(0));

  test('repeated trailers are kept in order', () =>
    expect(
      parseCommitMessage('x\n\nBacke-Actor: a\nBacke-Actor: b\n').trailers.get('Backe-Actor'),
    ).toEqual(['a', 'b']));
});
