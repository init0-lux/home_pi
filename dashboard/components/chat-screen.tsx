"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { useConnectionStatus } from "@/hooks/use-connection-status";
import { queryMcp } from "@/lib/api";

import { AppShell } from "./app-shell";

type ChatMessage = {
  content: string;
  role: "assistant" | "user";
};

const examples = [
  "Turn off all lights in Room 101",
  "Switch on fan in Room 102",
  "Turn on AC in Room 201",
];

export function ChatScreen() {
  const isOnline = useConnectionStatus();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      content:
        "I can control lights, fans, and AC units through the local hub. Ask me to switch devices on or off by room.",
      role: "assistant",
    },
  ]);

  const mutation = useMutation({
    mutationFn: queryMcp,
    onSuccess: (result, query) => {
      setMessages((current) => [
        ...current,
        { content: query, role: "user" },
        { content: result.response, role: "assistant" },
      ]);
      setInput("");
    },
  });

  return (
    <AppShell
      eyebrow="MCP Control Surface"
      isOnline={isOnline}
      subtitle="Natural language control wired to the same contracts as the dashboard actions so assistants and humans operate the same local system."
      title="Control Chat"
    >
      <section className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-[32px] border border-white/10 bg-slate-950/35 p-5">
          <div className="space-y-4">
            {messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`max-w-[85%] rounded-[28px] px-4 py-3 text-sm leading-7 ${
                  message.role === "assistant"
                    ? "bg-white/8 text-slate-100"
                    : "ml-auto bg-[linear-gradient(135deg,#f7c984,#f08f66)] text-slate-950"
                }`}
              >
                {message.content}
              </article>
            ))}
          </div>

          {mutation.error ? (
            <p className="mt-4 text-sm text-rose-200">{mutation.error.message}</p>
          ) : null}

          <form
            className="mt-6 flex flex-col gap-3 sm:flex-row"
            onSubmit={async (event) => {
              event.preventDefault();

              if (!input.trim()) {
                return;
              }

              await mutation.mutateAsync(input.trim());
            }}
          >
            <input
              className="flex-1 rounded-3xl border border-white/10 bg-white/6 px-5 py-4 text-sm text-white outline-none transition focus:border-white/20"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Turn off all lights in Room 101"
              value={input}
            />
            <button
              className="rounded-3xl bg-white px-5 py-4 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:opacity-60"
              disabled={mutation.isPending || !input.trim() || !isOnline}
              type="submit"
            >
              {mutation.isPending ? "Sending..." : "Send"}
            </button>
          </form>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-white/6 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Examples</p>
          <div className="mt-5 space-y-3">
            {examples.map((example) => (
              <button
                key={example}
                className="block w-full rounded-3xl border border-white/10 bg-slate-950/45 px-4 py-4 text-left text-sm text-slate-100 transition hover:bg-slate-950/65"
                onClick={() => setInput(example)}
                type="button"
              >
                {example}
              </button>
            ))}
          </div>
          <Link
            className="mt-6 inline-flex rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/8"
            href="/"
          >
            Return to dashboard
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
