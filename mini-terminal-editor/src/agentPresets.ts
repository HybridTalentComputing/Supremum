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
    description: "Anthropic coding agent for CLI",
    command: "claude --dangerously-skip-permissions",
    iconPath: "/agent-icons/claude.svg",
  },
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI coding agent for CLI",
    command:
      'codex -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true',
    iconPath: "/agent-icons/codex-white.svg",
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "Google coding agent for CLI",
    command: "gemini --yolo",
    iconPath: "/agent-icons/gemini.svg",
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Open-source AI coding agent for CLI",
    command: "opencode",
    iconPath: "/agent-icons/opencode.svg",
  },
  {
    id: "copilot",
    label: "Copilot",
    description: "GitHub Copilot agent for CLI",
    command: "copilot --allow-all",
    iconPath: "/agent-icons/copilot-white.svg",
  },
  {
    id: "cursor-agent",
    label: "Cursor Agent",
    description: "Cursor AI agent for CLI",
    command: "cursor-agent",
    iconPath: "/agent-icons/cursor-agent.svg",
  },
];
