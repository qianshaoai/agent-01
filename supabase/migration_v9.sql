-- Migration v9: extend exec_type to 4 values
-- Run in Supabase SQL Editor

ALTER TABLE workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_exec_type_check;
ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_exec_type_check
  CHECK (exec_type IN ('agent', 'manual', 'review', 'external'));
