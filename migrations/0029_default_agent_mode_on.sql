-- Enable agent mode by default for all existing and new projects
UPDATE projects SET enable_agent_mode = 1 WHERE enable_agent_mode = 0 OR enable_agent_mode IS NULL;
