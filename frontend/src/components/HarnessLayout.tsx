import { NavLink, Outlet } from 'react-router-dom';
import { EnvironmentIcon, McpIcon, PlugIcon, SkillIcon } from './Icons';

export function HarnessLayout() {
  return (
    <div className="harness-layout">
      <aside className="harness-nav" aria-label="Harness">
        <p className="harness-nav-title">Harness</p>
        <nav className="harness-nav-links">
          <NavLink
            to="/harness/skills"
            className={({ isActive }) => (isActive ? 'harness-nav-link active' : 'harness-nav-link')}
          >
            <SkillIcon />
            Skills
          </NavLink>
          <NavLink
            to="/harness/sandbox-envs"
            className={({ isActive }) => (isActive ? 'harness-nav-link active' : 'harness-nav-link')}
          >
            <EnvironmentIcon />
            Sandbox envs
          </NavLink>
          <NavLink
            to="/harness/mcp-servers"
            className={({ isActive }) => (isActive ? 'harness-nav-link active' : 'harness-nav-link')}
          >
            <McpIcon />
            MCP Servers
          </NavLink>
          <NavLink
            to="/harness/integrations"
            className={({ isActive }) => (isActive ? 'harness-nav-link active' : 'harness-nav-link')}
          >
            <PlugIcon />
            Integrations
          </NavLink>
        </nav>
      </aside>
      <div className="harness-content">
        <Outlet />
      </div>
    </div>
  );
}
