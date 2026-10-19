import type { AgentToolCall, AgentStats, AgentContext, AgentSubAgent, AgentMention } from "@toonflow/server/agent/types";

export type AgentAttachment = { name: string; path: string; mimeType: string; file?: File };

export type AgentMessagePart =
  | { id: string; type: "text"; content: string }
  | { id: string; type: "thinking"; content: string; collapsed?: boolean; duration?: number }
  | { id: string; type: "tool"; tool: AgentToolCall; collapsed?: boolean };

export type AgentSuanliTask = {
  taskId?: string;
  clientTaskId?: string;
  modelLabel: string;
  status: "submitting" | "checking" | "queued" | "processing" | "completed" | "failed" | "cancelled" | "timeout" | "unavailable";
  position?: number;
  result?: unknown;
  error?: string;
};

export type AgentMessage = {
  id: string;
  entryId?: string;
  replyTo?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: AgentAttachment[];
  mentions?: AgentMention[];
  parts?: AgentMessagePart[];
  streaming?: boolean;
  error?: string;
  report?: { file: string; name: string };
  task?: AgentSuanliTask;
};

export type AgentHistory = { file: string; name: string; modified: string; messageCount: number };

export type AgentConversation = {
  file: string;
  name: string;
  messages: AgentMessage[];
  providerId?: string;
  modelId?: string;
  thinkingLevel?: string;
  stats?: AgentStats;
  contextUsage?: AgentContext;
  parentFile?: string;
  subAgents?: AgentSubAgent[];
  running?: boolean;
};
