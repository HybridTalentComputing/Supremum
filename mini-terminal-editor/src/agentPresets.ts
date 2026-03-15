export type AgentPresetId =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "copilot"
  | "cursor-agent";

export type AgentPreset = {
  id: AgentPresetId;
  label: string;
  description: string;
  command: string;
  iconPath: string;
};

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "claude",
    label: "Claude Code",
    description: "Danger mode: All permissions auto-approved",
    command: "claude --dangerously-skip-permissions",
    iconPath: "/agent-icons/claude.svg",
  },
  {
    id: "codex",
    label: "Codex",
    description: "Danger mode: All permissions auto-approved",
    command:
      'codex -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true',
    iconPath: "/agent-icons/codex.svg",
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "Danger mode: All permissions auto-approved",
    command: "gemini --yolo",
    iconPath: "/agent-icons/gemini.svg",
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Open-source AI coding agent",
    command: "opencode",
    iconPath: "/agent-icons/opencode.svg",
  },
  {
    id: "copilot",
    label: "Copilot",
    description: "Danger mode: All permissions auto-approved",
    command: "copilot --allow-all",
    iconPath: "/agent-icons/copilot.svg",
  },
  {
    id: "cursor-agent",
    label: "Cursor Agent",
    description: "Cursor AI agent for terminal-based coding assistance",
    command: "cursor-agent",
    iconPath: "/agent-icons/cursor-agent.svg",
  },
];
