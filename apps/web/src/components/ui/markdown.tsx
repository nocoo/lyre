"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders markdown content with GFM support and compact prose styling.
 * Designed for AI-generated summaries and other markdown text blocks.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Headings — compact sizing
        h1: ({ children: c }) => (
          <h3 className="text-base font-semibold text-foreground mt-4 mb-1.5 first:mt-0">
            {c}
          </h3>
        ),
        h2: ({ children: c }) => (
          <h4 className="text-sm font-semibold text-foreground mt-3 mb-1 first:mt-0">
            {c}
          </h4>
        ),
        h3: ({ children: c }) => (
          <h5 className="text-sm font-medium text-foreground mt-2.5 mb-1 first:mt-0">
            {c}
          </h5>
        ),
        // Paragraphs
        p: ({ children: c }) => (
          <p className="text-sm text-foreground leading-relaxed mb-2 last:mb-0">
            {c}
          </p>
        ),
        // Lists
        ul: ({ children: c }) => (
          <ul className="text-sm text-foreground list-disc pl-5 mb-2 space-y-0.5 last:mb-0">
            {c}
          </ul>
        ),
        ol: ({ children: c }) => (
          <ol className="text-sm text-foreground list-decimal pl-5 mb-2 space-y-0.5 last:mb-0">
            {c}
          </ol>
        ),
        li: ({ children: c }) => (
          <li className="leading-relaxed">{c}</li>
        ),
        // Inline
        strong: ({ children: c }) => (
          <strong className="font-semibold">{c}</strong>
        ),
        em: ({ children: c }) => <em className="italic">{c}</em>,
        code: ({ children: c }) => (
          <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
            {c}
          </code>
        ),
        // Block code
        pre: ({ children: c }) => (
          <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto mb-2 last:mb-0">
            {c}
          </pre>
        ),
        // Blockquote
        blockquote: ({ children: c }) => (
          <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground italic mb-2 last:mb-0">
            {c}
          </blockquote>
        ),
        // Horizontal rule
        hr: () => <hr className="border-border my-3" />,
        // Table (GFM)
        table: ({ children: c }) => (
          <div className="overflow-x-auto mb-2 last:mb-0">
            <table className="text-sm w-full border-collapse">{c}</table>
          </div>
        ),
        thead: ({ children: c }) => (
          <thead className="border-b border-border">{c}</thead>
        ),
        th: ({ children: c }) => (
          <th className="text-left text-xs font-medium text-muted-foreground px-2 py-1.5">
            {c}
          </th>
        ),
        td: ({ children: c }) => (
          <td className="text-sm px-2 py-1.5 border-b border-border/50">
            {c}
          </td>
        ),
        // Links
        a: ({ children: c, href }) => (
          <a
            href={href}
            className="text-primary underline underline-offset-2 hover:text-primary/80"
            target="_blank"
            rel="noopener noreferrer"
          >
            {c}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
