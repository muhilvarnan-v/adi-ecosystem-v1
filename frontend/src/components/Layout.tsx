import { NavLink, Outlet } from 'react-router-dom';
import { AgentIcon, HarnessIcon, LlmIcon, SparklesIcon, TargetIcon, WorkflowIcon } from './Icons';

export function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <SparklesIcon />
          </div>
          <div className="brand-text">
            <span className="brand-mark">AID</span>
            <span className="brand-sub">Agent Platform</span>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <TargetIcon />
            Applications
          </NavLink>
          <NavLink to="/workflows" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <WorkflowIcon />
            Workflows
          </NavLink>
          <NavLink to="/agents" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <AgentIcon />
            Agents
          </NavLink>
          <NavLink to="/llm" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <LlmIcon />
            LLM
          </NavLink>
          <NavLink to="/harness" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <HarnessIcon />
            Harness
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <p>Applications, workflows, agents, LLM models, and harness tools for coding agents.</p>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
