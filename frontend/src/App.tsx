import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HarnessLayout } from './components/HarnessLayout';
import { Layout } from './components/Layout';
import { AgentsPage } from './pages/AgentsPage';
import { LlmsPage } from './pages/LlmsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { McpServersPage } from './pages/McpServersPage';
import { SkillsPage } from './pages/SkillsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ApplicationsPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="llm" element={<LlmsPage />} />
          <Route path="harness" element={<HarnessLayout />}>
            <Route index element={<Navigate to="skills" replace />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="sandbox-envs" element={<WorkspacesPage />} />
            <Route path="workspaces" element={<Navigate to="/harness/sandbox-envs" replace />} />
            <Route path="mcp-servers" element={<McpServersPage />} />
            <Route path="integrations" element={<IntegrationsPage />} />
          </Route>
          <Route path="skills" element={<Navigate to="/harness/skills" replace />} />
          <Route path="environments" element={<Navigate to="/harness/sandbox-envs" replace />} />
          <Route path="workspaces" element={<Navigate to="/harness/sandbox-envs" replace />} />
          <Route path="mcp-servers" element={<Navigate to="/harness/mcp-servers" replace />} />
          <Route path="integrations" element={<Navigate to="/harness/integrations" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
