export type WorkflowRole = 'develop' | 'review' | 'test' | 'deploy';

export type WorkflowRoles = Partial<Record<WorkflowRole, string>>;

export interface WorkflowDefinition {
  id: string;
  name: string;
  steps: WorkflowRole[];
  workflow_roles: WorkflowRoles;
  workflow_max_cycles: number;
  /** Optional Harness sandbox env record id (Docker or hosted API runtime). */
  sandbox_environment_id?: string | null;
}

export interface Application {
  id: string;
  user_id: string;
  title: string;
  description: string;
  github_repo_url: string | null;
  workflow_roles: WorkflowRoles;
  workflow_max_cycles: number;
  self_healing_enabled: boolean;
  self_healing_workflow_id: string | null;
  created_at: string;
  updated_at: string;
}

export type GoalSource = 'manual' | 'jira' | 'trello' | 'zendesk';
export type GoalStatus = 'backlog' | 'in_progress' | 'done';

export type GoalExecutionStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface WorkflowGraphNode {
  id: string;
  phase: string;
  cycle: number;
  status: string;
  agent?: string | null;
  role?: string | null;
  summary?: string | null;
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowTimelineEntry {
  phase: string;
  cycle: number;
  agent?: string;
  status?: string;
  summary?: string;
  feedback?: string;
  nodeId?: string;
  event: string;
}

export interface Goal {
  id: string;
  user_id: string;
  application_id: string | null;
  title: string;
  description: string;
  source: GoalSource;
  status: GoalStatus;
  external_id: string | null;
  external_url: string | null;
  agent_record_id: string | null;
  workflow_id: string | null;
  workflow_roles: WorkflowRoles;
  workflow_steps: WorkflowRole[];
  workflow_max_cycles: number | null;
  interaction_id: string | null;
  runtime_environment_id: string | null;
  execution_status: GoalExecutionStatus | null;
  execution_error: string | null;
  pr_url: string | null;
  workflow_graph: WorkflowGraph | null;
  resumable: boolean;
  created_at: string;
  updated_at: string;
}

export type IntegrationProvider = 'jira' | 'trello' | 'github' | 'zendesk';

export interface IntegrationStatus {
  provider: IntegrationProvider;
  connected: boolean;
  connected_at: string | null;
  account_label: string | null;
}

export interface JiraSpace {
  id: string;
  key: string;
  name: string;
}

export interface ExternalIssue {
  id: string;
  key: string | null;
  title: string;
  description: string;
  url: string | null;
  space_key: string | null;
  space_name: string | null;
}

export interface ExternalCard {
  id: string;
  title: string;
  description: string;
  url: string | null;
  board_name: string | null;
}

export interface SelfHealingIncident {
  id: string;
  key: string | null;
  title: string;
  description: string;
  url: string | null;
  status: string | null;
  priority: string | null;
  goal_id: string | null;
  goal_status: GoalStatus | null;
  execution_status: GoalExecutionStatus | null;
  pr_url: string | null;
}

export type SkillSource = 'manual' | 'github';

export interface Skill {
  id: string;
  user_id: string;
  skill_id: string;
  display_name: string;
  description: string;
  source: SkillSource;
  state: string | null;
  gcp_name: string | null;
  github_repo: string | null;
  github_branch: string | null;
  github_base_path: string | null;
  include_patterns: string[] | null;
  has_skill_md: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkillCreatePayload {
  skill_id: string;
  display_name: string;
  description: string;
  skill_md: string;
  additional_files?: { path: string; content: string }[];
}

export interface SkillFromGitHubPayload {
  skill_id: string;
  display_name: string;
  description: string;
  repo: string;
  branch: string;
  base_path: string;
  include_patterns: string[];
}

export interface GitHubRepo {
  id: string;
  full_name: string;
  description: string;
  default_branch: string;
  url: string | null;
  private: boolean;
}

export type NetworkMode = 'default' | 'disabled' | 'allowlist';

export interface SkillAttachment {
  skill_id: string;
  target: string;
}

export interface EnvironmentSourceRepository {
  type: 'repository';
  source: string;
  target: string;
}

export interface EnvironmentSourceGcs {
  type: 'gcs';
  source: string;
  target: string;
}

export interface EnvironmentSourceInline {
  type: 'inline';
  content: string;
  target: string;
}

export type EnvironmentSource =
  | EnvironmentSourceRepository
  | EnvironmentSourceGcs
  | EnvironmentSourceInline;

export interface NetworkAllowRule {
  domain: string;
  transform?: Record<string, string> | null;
}

export type SandboxEnvType = 'docker' | 'remote';

export interface Environment {
  id: string;
  user_id: string;
  env_id: string;
  display_name: string;
  description: string;
  sandbox_type: SandboxEnvType;
  docker_server_image: string;
  docker_host_port: number;
  remote_runtime_api_url: string;
  remote_server_image: string;
  remote_runtime_api_key_set: boolean;
  skill_attachments: SkillAttachment[];
  additional_sources: EnvironmentSource[];
  network_mode: NetworkMode;
  network_allowlist: NetworkAllowRule[];
  runtime_environment_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Harness sandbox environment (Docker or hosted API runtime); API `/api/workspaces`. */
export type Workspace = Environment;

export interface EnvironmentCreatePayload {
  env_id: string;
  display_name: string;
  description: string;
  sandbox_type: SandboxEnvType;
  docker_server_image?: string;
  docker_host_port?: number;
  remote_runtime_api_url?: string;
  remote_runtime_api_key?: string;
  remote_server_image?: string;
  skill_attachments?: SkillAttachment[];
  additional_sources?: EnvironmentSource[];
  network_mode?: NetworkMode;
  network_allowlist?: NetworkAllowRule[];
}

export interface EnvironmentConfig {
  env_id: string;
  config: Record<string, unknown>;
}

export type LlmVendorType = 'litellm';

export interface LlmProfile {
  id: string;
  user_id: string;
  display_name: string;
  description: string;
  vendor_type: LlmVendorType;
  base_url: string;
  model: string;
  api_key_set: boolean;
  created_at: string;
  updated_at: string;
}

export interface LlmProfileCreatePayload {
  display_name: string;
  description?: string;
  vendor_type: LlmVendorType;
  base_url: string;
  model: string;
  api_key: string;
}

export interface LlmVendorOption {
  id: LlmVendorType;
  label: string;
  description: string;
}

export type OpenHandsToolName = 'terminal' | 'file_editor' | 'task_tracker';
export type CriticMode = 'finish_and_message' | 'all_actions';
export type SecurityAnalyzerType = 'llm' | 'none';

export interface Agent {
  id: string;
  user_id: string;
  agent_id: string;
  display_name: string;
  description: string;
  agent_kind: string;
  system_prompt: string;
  environment_id: string | null;
  mcp_server_ids: string[];
  llm_profile_id: string | null;
  tools: OpenHandsToolName[];
  load_project_skills: boolean;
  condenser_enabled: boolean;
  condenser_max_size: number;
  critic_enabled: boolean;
  critic_mode: CriticMode;
  enable_iterative_refinement: boolean;
  critic_threshold: number;
  max_refinement_iterations: number;
  confirmation_mode: boolean;
  security_analyzer: SecurityAnalyzerType;
  skill_attachments: SkillAttachment[];
  created_at: string;
  updated_at: string;
}

export interface AgentCreatePayload {
  /** If omitted, the server generates a unique agent ID. */
  agent_id?: string;
  display_name: string;
  description: string;
  system_prompt: string;
  environment_id?: string | null;
  mcp_server_ids: string[];
  llm_profile_id: string;
  tools: OpenHandsToolName[];
  /** Defaults to true when omitted. */
  load_project_skills?: boolean;
  condenser_enabled: boolean;
  condenser_max_size: number;
  critic_enabled: boolean;
  critic_mode: CriticMode;
  enable_iterative_refinement: boolean;
  critic_threshold: number;
  max_refinement_iterations: number;
  confirmation_mode: boolean;
  security_analyzer: SecurityAnalyzerType;
  skill_attachments: SkillAttachment[];
}

export interface OpenHandsSchemaSection {
  key: string;
  label: string;
  description: string;
  options?: { id: string; label: string; description?: string }[];
  critic_modes?: { id: string; label: string }[];
  security_analyzers?: { id: string; label: string }[];
}

export interface OpenHandsAgentSchema {
  docs_url: string;
  agent_kind: string;
  sections: OpenHandsSchemaSection[];
  default_tools: OpenHandsToolName[];
}

export interface AgentConfig {
  agent_id: string;
  agent_kind: string;
  config: Record<string, unknown>;
}

export interface McpServer {
  id: string;
  user_id: string;
  name: string;
  url: string;
  header_key: string;
  header_value: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface McpServerCreatePayload {
  name: string;
  url: string;
  header_key?: string;
  header_value?: string;
  description?: string;
}
