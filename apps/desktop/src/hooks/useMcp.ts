import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type McpInfo } from "@/lib/api";

const KEY = ["mcp-info"] as const;

/** Datos para conectar Claude por MCP y si ya está registrado en Claude Code. */
export function useMcpInfo() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<McpInfo>("/api/integrations/mcp") });
}

export function useRegisterClaudeCode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<McpInfo>("/api/integrations/mcp:register-claude-code", {}),
    onSuccess: (info) => client.setQueryData(KEY, info),
  });
}
