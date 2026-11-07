-- ~/.config/nvim/lua/competitive/theme_ac/config.lua
-- Centralized constants for the Theme-AC guided AtCoder practice engine.
-- Kept tiny and dependency-free so every other theme_ac module can require
-- it without risk of circular requires.

local M = {}

-- Interpreter + script location for the Python accounting-ledger backend.
-- "python3" (not "python") because that's the standard command on Ubuntu/WSL,
-- which is the deployment target even though development happens on Windows.
M.python_cmd = "python3"
M.script_path = vim.fn.expand("~/playground/theme_ac.py")

-- All Theme-AC problem files live directly in the existing shared practice/
-- directory (no scaffold, no per-problem subdirectories - see implementation
-- plan's "Resolved Decisions" table).
M.practice_dir = vim.fn.expand("~/playground/contests/practice/")

M.default_candidate_count = 3

-- ============================================================================
-- Accountability Timer - per-problem budget formula constants.
--
-- minutes = base + (gap/100) * (gap >= 0 and hard_slope or easy_slope)
-- clamped to [clamp_min, clamp_max]. `gap = difficulty - rating`.
--
-- Contest is intentionally tighter than Study at every difficulty level.
-- Study's hard_slope (15) is deliberately STEEPER than Contest's (10) so the
-- Study-vs-Contest time bonus GROWS on harder problems (genuine learning
-- happening there deserves more extra leniency, not less) while both modes
-- share the same easy_slope (4) - no learning premium for review-tier
-- problems, only the flat base-minutes offset distinguishes them there.
-- See the timer-mechanics design discussion for the full worked table.
-- ============================================================================
M.default_session_mode = "contest"

M.budget = {
	contest = { base = 25, hard_slope = 10, easy_slope = 4, clamp_min = 10, clamp_max = 60 },
	study = { base = 35, hard_slope = 15, easy_slope = 4, clamp_min = 15, clamp_max = 150 },
}

-- ============================================================================
-- Rating graph - how many of the most recent history.json entries to fetch
-- for the Graph tab's chart. This is NOT the number of visible chart columns
-- (that's bounded by the dashboard window's actual width, typically far
-- fewer) - it's the raw-data input to the min/max-preserving bucketer, so
-- that even at large history sizes a real spike/crash between two adjacent
-- terminal columns is still reflected (as a bucket's min/max range) rather
-- than silently discarded. 300 gives ~2+ raw entries per bucket even on a
-- fairly wide (~150 col) window, without fetching/parsing unboundedly-growing
-- history on every dashboard open or verdict log.
-- ============================================================================
M.graph_history_limit = 300

return M

