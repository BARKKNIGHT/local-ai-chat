import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

// Enhanced Code Block with Copy Button
export const CodeBlock = ({ children, className }) => {
  const [copied, setCopied] = useState(false);
  const textInput = String(children).replace(/\n$/, '');

  // Extract language from className (e.g., "language-python")
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : 'text';

  const handleCopy = () => {
    navigator.clipboard.writeText(textInput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-4 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 group">
      <div className="flex justify-between items-center px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase">
          {lang}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          {copied ? (
            <Check size={14} className="text-emerald-500" />
          ) : (
            <Copy size={14} />
          )}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        <code className="font-mono text-sm text-slate-800 dark:text-slate-200 whitespace-pre">
          {children}
        </code>
      </div>
    </div>
  );
};

// Robust Markdown Renderer
export default function FormatMessage({
  content,
  isUserMessage = false,
}) {
  // DIFFERENT text colors for user vs assistant
  const textColor = isUserMessage
    ? 'text-slate-900 dark:text-slate-50'
    : 'text-slate-800 dark:text-slate-200';

  const headingColor = isUserMessage
    ? 'text-slate-950 dark:text-slate-50'
    : 'text-slate-900 dark:text-slate-100';

  const linkColor = isUserMessage
    ? 'text-indigo-700 dark:text-indigo-300'
    : 'text-indigo-600 dark:text-indigo-400';

  return (
    <div className="markdown-content space-y-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 1. Headers
          h1: ({ node, ...props }) => (
            <h1
              className={`text-2xl font-bold ${headingColor} mt-6 mb-3 pb-2 border-b border-slate-200 dark:border-slate-700`}
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2
              className={`text-xl font-bold ${headingColor} mt-5 mb-2`}
              {...props}
            />
          ),
          h3: ({ node, ...props }) => (
            <h3
              className={`text-lg font-bold ${headingColor} mt-4 mb-2`}
              {...props}
            />
          ),

          // 2. Links
          a: ({ node, ...props }) => (
            <a
              className={`${linkColor} hover:underline font-medium`}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),

          // 3. Lists
          ul: ({ node, ...props }) => (
            <ul
              className={`list-disc list-outside ml-5 space-y-1 ${textColor}`}
              {...props}
            />
          ),
          ol: ({ node, ...props }) => (
            <ol
              className={`list-decimal list-outside ml-5 space-y-1 ${textColor}`}
              {...props}
            />
          ),

          // 4. Code (Inline vs Block)
          code({ node, inline, className, children, ...props }) {
            if (inline) {
              return (
                <code
                  className="bg-slate-100 dark:bg-slate-800 text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded text-xs font-mono font-bold border border-slate-200 dark:border-slate-700"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <>{children}</>;
          },

          // Render the outer <pre> (fenced code blocks)
          pre: ({ node, children, ...props }) => {
            const codeElement = Array.isArray(children)
              ? children[0]
              : children;
            const className = codeElement?.props?.className;
            const codeChildren = codeElement?.props?.children ?? '';
            return (
              <CodeBlock className={className}>{codeChildren}</CodeBlock>
            );
          },

          // 5. Paragraphs
          p: ({ node, ...props }) => (
            <p className={`${textColor} leading-7`} {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}