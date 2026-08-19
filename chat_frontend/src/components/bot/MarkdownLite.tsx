import { Fragment, type ReactNode } from 'react';

/**
 * A deliberately minimal Markdown renderer for assistant answers.
 *
 * Covers only what the system prompt actually asks the model to produce —
 * headings, lists, code, bold/italic, and `[n]` citation markers. It builds
 * React elements directly and never touches `dangerouslySetInnerHTML`, so
 * model output cannot inject markup. Adding a full Markdown dependency for
 * this one surface wasn't worth the bundle.
 */

interface Props {
  text: string;
  /** Highlights `[1]`-style markers; the number is passed back on click. */
  onCitationClick?: (index: number) => void;
}

function renderInline(text: string, onCitationClick?: (index: number) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  // One pass over bold, italic, inline code, and citation markers.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[\d+\])/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];

    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key++} className="px-1 py-0.5 rounded text-[0.85em] bg-black/10 dark:bg-white/15">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const index = Number(token.slice(1, -1));
      nodes.push(
        <button
          key={key++}
          type="button"
          onClick={() => onCitationClick?.(index)}
          title={`Jump to source ${index}`}
          className="align-super mx-0.5 px-1.5 rounded-full text-[10px] font-bold bg-brand-strong/20 text-brand-text dark:text-primary hover:bg-brand-strong/35 transition"
        >
          {index}
        </button>,
      );
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function MarkdownLite({ text, onCitationClick }: Props) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let listBuffer: string[] = [];
  let listOrdered = false;
  let codeBuffer: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    const items = listBuffer.map((item, i) => (
      <li key={i} className="ml-4">
        {renderInline(item, onCitationClick)}
      </li>
    ));
    blocks.push(
      listOrdered ? (
        <ol key={key++} className="list-decimal my-1.5 space-y-0.5">{items}</ol>
      ) : (
        <ul key={key++} className="list-disc my-1.5 space-y-0.5">{items}</ul>
      ),
    );
    listBuffer = [];
  };

  for (const line of lines) {
    // Fenced code block — buffer verbatim until the closing fence.
    if (line.trimStart().startsWith('```')) {
      if (codeBuffer === null) {
        flushList();
        codeBuffer = [];
      } else {
        blocks.push(
          <pre
            key={key++}
            className="my-2 p-3 rounded-xl text-xs overflow-x-auto bg-black/10 dark:bg-white/10"
          >
            <code>{codeBuffer.join('\n')}</code>
          </pre>,
        );
        codeBuffer = null;
      }
      continue;
    }
    if (codeBuffer !== null) {
      codeBuffer.push(line);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);

    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      // A list of the other kind starting mid-stream closes the current one.
      if (listBuffer.length > 0 && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listBuffer.push((bullet ?? numbered)![1]);
      continue;
    }

    flushList();

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const size = ['text-base', 'text-sm', 'text-sm'][heading[1].length - 1];
      blocks.push(
        <p key={key++} className={`${size} font-semibold mt-2.5 mb-1`}>
          {renderInline(heading[2], onCitationClick)}
        </p>,
      );
      continue;
    }

    if (line.trim() === '') {
      blocks.push(<div key={key++} className="h-2" />);
      continue;
    }

    blocks.push(
      <p key={key++} className="my-0.5">
        {renderInline(line, onCitationClick)}
      </p>,
    );
  }

  flushList();
  // An answer cut off mid-fence still shows what streamed in.
  if (codeBuffer !== null && codeBuffer.length > 0) {
    blocks.push(
      <pre key={key++} className="my-2 p-3 rounded-xl text-xs overflow-x-auto bg-black/10 dark:bg-white/10">
        <code>{codeBuffer.join('\n')}</code>
      </pre>,
    );
  }

  return <Fragment>{blocks}</Fragment>;
}
