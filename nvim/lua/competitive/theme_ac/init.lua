-- ~/.config/nvim/lua/competitive/theme_ac/init.lua
-- Theme-AC session state machine. Orchestrates the Python backend via an
-- async vim.system() bridge.
--
-- Requires Neovim >= 0.10 (vim.system was introduced there).

local config = require("competitive.theme_ac.config")

-- Converts vim.NIL (JSON null) → Lua nil recursively. vim.json.decode
-- turns JSON null into a special userdata sentinel that is truthy and
-- crashes on arithmetic — this normalizes the boundary once in run_python()
-- so every downstream consumer can use plain `if x then` idioms safely.
local function sanitize_json(value)
	if value == vim.NIL then
		return nil
	end
	if type(value) == "table" then
		local clean = {}
		for k, v in pairs(value) do
			clean[k] = sanitize_json(v)
		end
		return clean
	end
	return value
end

local M = {}

-- ============================================================================
-- Session State (in-memory only)
-- ============================================================================

local state = {
	is_active = false,
	candidates = {},
	workspace = {},
	-- Session-level tracking for the close summary
	session_start_time = nil,
	session_start_rating = nil,
	problems_accepted = 0,
	verdicts_logged = 0,
	-- Accountability Timer (Iteration 3): "contest" | "study", fixed for the
	-- whole session once chosen at open_session(). current_rating tracks the
	-- latest known rating (seeded at open_session, refreshed after every
	-- logged verdict) so accept_problem() always budgets against a fresh
	-- number rather than a stale session-start snapshot. pool_deadline is the
	-- single shared, fungible deadline (epoch seconds) covering everything
	-- currently unresolved in state.workspace - nil means "no active budget"
	-- (either nothing has been accepted yet, or the workspace just emptied).
	session_mode = nil,
	current_rating = nil,
	pool_deadline = nil,
	-- Iteration 4: fires exactly once per pool "lifetime" (reset to false
	-- whenever pool_deadline clears back to nil) - guards the one-time
	-- "time's up" notification from repeating every timer tick while the
	-- pool sits in overtime.
	pool_overtime_notified = false,
}

-- ============================================================================
-- Accountability Timer - Iteration 4: background overtime watcher.
--
-- A libuv timer independent of the dashboard's own visibility - overtime
-- must be detected even while the user is heads-down in their .cpp buffer
-- with the dashboard closed, per the design's "nothing is forced, but you
-- must be honestly informed" requirement.
-- ============================================================================

local overtime_timer = nil

local function stop_overtime_timer()
	if overtime_timer then
		overtime_timer:stop()
		overtime_timer:close()
		overtime_timer = nil
	end
end

-- Flags every currently-unresolved workspace entry as overtime. Sticky by
-- construction: once set here, only cleared when the entry itself is
-- resolved (verdict logged) and removed from state.workspace entirely -
-- there is no code path that ever sets entry.overtime back to false.
local function mark_all_unresolved_overtime()
	for _, entry in pairs(state.workspace) do
		entry.overtime = true
	end
end

local function check_pool_overtime()
	if not state.is_active or not state.pool_deadline or state.pool_overtime_notified then
		return
	end
	if os.time() >= state.pool_deadline then
		state.pool_overtime_notified = true
		mark_all_unresolved_overtime()
		vim.notify(
			string.format(
				"\u{23F0} Theme-AC: time's up - %d problem(s) now overtime. "
					.. "Keep working - any verdict logged from here on will record as DNF.",
				vim.tbl_count(state.workspace)
			),
			vim.log.levels.WARN
		)
	end
end

local function start_overtime_watch()
	stop_overtime_timer()
	local uv = vim.uv or vim.loop
	overtime_timer = uv.new_timer()
	overtime_timer:start(1000, 1000, function()
		vim.schedule(check_pool_overtime)
	end)
end

-- ============================================================================
-- Async bridge to the Python backend
-- ============================================================================

-- Runs `python3 theme_ac.py <args...>`, decodes the JSON stdout, and invokes
-- callback(result, err) on the main event loop (never in the fast-event
-- context vim.system's callback normally runs in - vim.notify/vim.cmd etc.
-- are unsafe there, hence the vim.schedule wrap).
function M.run_python(args, callback)
	local cmd = { config.python_cmd, config.script_path }
	for _, a in ipairs(args) do
		table.insert(cmd, a)
	end

	vim.system(cmd, { text = true }, function(obj)
		vim.schedule(function()
			if obj.code ~= 0 then
				local detail = (obj.stderr ~= nil and obj.stderr ~= "") and obj.stderr or (obj.stdout or "")
				callback(nil, string.format("theme_ac.py exited with code %d: %s", obj.code, detail))
				return
			end

			-- theme_ac.py deliberately keeps stdout as pure JSON and routes
			-- operational warnings to stderr via eprint(). Surface those here
			-- even on success so e.g. a stale-cache fallback is visible.
			if obj.stderr ~= nil and obj.stderr:gsub("%s+", "") ~= "" then
				vim.notify("Theme-AC: " .. obj.stderr, vim.log.levels.WARN)
			end

			local ok, decoded = pcall(vim.json.decode, obj.stdout)
			if ok then
				decoded = sanitize_json(decoded)
			end
			if not ok then
				callback(nil, "Theme-AC: failed to decode JSON from theme_ac.py: " .. tostring(obj.stdout))
				return
			end

			if type(decoded) == "table" and decoded.error then
				callback(nil, decoded.error)
				return
			end

			callback(decoded, nil)
		end)
	end)
end

-- ============================================================================
-- Guard clause - mirrors dispatcher.lua's execute_if_active pattern.
-- Theme-AC only ever READS competitive.init.is_active, never writes it.
-- ============================================================================

local function require_competitive_session()
	if not require("competitive.init").is_active then
		vim.notify("Theme-AC: start a competitive session first (<leader>cs)", vim.log.levels.WARN)
		return false
	end
	return true
end

-- ============================================================================
-- Time formatting helpers
-- ============================================================================

function M.get_elapsed(entry)
	local secs = os.time() - entry.start_time
	local m = math.floor(secs / 60)
	local s = secs % 60
	return string.format("%dm %02ds", m, s)
end

-- Formats a plain seconds count as "Nm SSs" - used for pool-remaining/
-- overtime displays (Iterations 3-6), distinct from get_elapsed() which
-- takes a workspace entry and always measures FROM entry.start_time.
function M.format_duration_mmss(seconds)
	seconds = math.max(0, math.floor(seconds))
	local m = math.floor(seconds / 60)
	local s = seconds % 60
	return string.format("%dm %02ds", m, s)
end

-- Formats total session duration for the close summary.
local function format_session_duration(seconds)
	local m = math.floor(seconds / 60)
	local h = math.floor(m / 60)
	m = m % 60
	if h > 0 then
		return string.format("%dh %02dm", h, m)
	end
	return string.format("%dm", m)
end

-- ============================================================================
-- Accountability Timer - Iteration 2: per-problem budget formula.
--
-- Pure functions, no state interaction - safe to call directly for manual
-- verification, e.g.:
--   :lua print(require('competitive.theme_ac').compute_budget_minutes(1050, 900, "contest"))
-- ============================================================================

-- Returns the raw (unrounded) budget in minutes for a problem of the given
-- `difficulty` against the user's `rating`, under the given `mode`
-- ("contest" | "study", defaults to config.default_session_mode).
-- See config.lua's `M.budget` table for the constants and rationale.
function M.compute_budget_minutes(difficulty, rating, mode)
	mode = mode or config.default_session_mode
	local c = config.budget[mode]
	if not c then
		error(string.format("Theme-AC: unknown session mode %q (expected 'contest' or 'study')", tostring(mode)))
	end

	local gap = difficulty - rating
	local minutes
	if gap >= 0 then
		minutes = c.base + (gap / 100) * c.hard_slope
	else
		minutes = c.base + (gap / 100) * c.easy_slope
	end

	if minutes < c.clamp_min then
		minutes = c.clamp_min
	elseif minutes > c.clamp_max then
		minutes = c.clamp_max
	end
	return minutes
end

-- Convenience wrapper: same as compute_budget_minutes but rounded to whole
-- seconds - this is the unit accept_problem() will actually add to the pool
-- deadline (Iteration 3), since os.time() deals in whole seconds.
function M.compute_budget_seconds(difficulty, rating, mode)
	return math.floor(M.compute_budget_minutes(difficulty, rating, mode) * 60 + 0.5)
end

-- ============================================================================
-- Core flows: open_session, accept_problem, discard_problem, reroll_candidates
-- ============================================================================

-- Fetches `count` candidates from the Python backend. If a Theme-AC session
-- is already active, re-uses the existing state (idempotent open - `mode`
-- is ignored in that case, since session_mode is fixed for the session's
-- whole lifetime once chosen).
-- on_done (optional) fires once state is ready - used by dashboard.lua.
function M.open_session(count, mode, on_done)
	count = count or config.default_candidate_count
	mode = mode or config.default_session_mode

	if not require_competitive_session() then
		return
	end

	if state.is_active then
		vim.notify(
			string.format(
				"Theme-AC: session already active (%d candidates, %d in workspace, mode=%s).",
				#state.candidates,
				vim.tbl_count(state.workspace),
				state.session_mode
			),
			vim.log.levels.INFO
		)
		if on_done then
			on_done()
		end
		return
	end

	vim.notify("Theme-AC: fetching candidates...", vim.log.levels.INFO)
	M.run_python({ "candidates", "--count", tostring(count) }, function(candidates, err)
		if err then
			vim.notify("Theme-AC: " .. err, vim.log.levels.ERROR)
			if on_done then
				on_done()
			end
			return
		end
		state.is_active = true
		state.candidates = candidates
		state.session_start_time = os.time()
		state.session_mode = mode
		state.pool_deadline = nil
		state.pool_overtime_notified = false
		state.problems_accepted = 0
		state.verdicts_logged = 0
		start_overtime_watch()
		-- Seed the starting/current rating for the session close summary AND
		-- for accept_problem()'s budget formula.
		M.run_python({ "stats" }, function(stats, _)
			if stats then
				state.session_start_rating = stats.current_rating
				state.current_rating = stats.current_rating
			end
			if on_done then
				on_done()
			end
		end)
	end)
end

-- Re-fetches a fresh candidate pool, replacing the current one.
function M.reroll_candidates(count, on_done)
	count = count or config.default_candidate_count
	if not state.is_active then
		vim.notify("Theme-AC: no active session.", vim.log.levels.WARN)
		return
	end
	M.run_python({ "candidates", "--count", tostring(count) }, function(candidates, err)
		if err then
			vim.notify("Theme-AC: " .. err, vim.log.levels.ERROR)
			if on_done then
				on_done()
			end
			return
		end
		state.candidates = candidates
		if on_done then
			on_done()
		end
	end)
end

-- Accepts a candidate by 1-based list index OR by problem id string.
-- Moves it from candidates -> workspace (with start_time = now), then opens
-- practice/{id}.cpp - this triggers scaffold.lua's existing BufNewFile
-- autocmd (default.cpp template injection).
function M.accept_problem(identifier)
	if not state.is_active then
		vim.notify("Theme-AC: no active session. Run open_session() first.", vim.log.levels.WARN)
		return
	end

	-- Iteration 4: one-directional guard. Rescuing the pool IN ADVANCE
	-- (accepting more work while still positive) is intentional and
	-- rewarded (Iteration 3's additive pooling). Rescuing it IN ARREARS
	-- (chain-accepting AFTER it's already gone negative, to paper over an
	-- overrun) is explicitly blocked here - every currently-overtime entry
	-- must be resolved (verdict logged, which will force DNF - see
	-- Iteration 5) before anything new can be accepted.
	if state.pool_deadline and os.time() > state.pool_deadline then
		vim.notify(
			"Theme-AC: pool is overtime - resolve your overtime problem(s) before accepting more.",
			vim.log.levels.WARN
		)
		return
	end

	local idx, problem = nil, nil
	if type(identifier) == "number" then
		idx = identifier
		problem = state.candidates[idx]
	else
		for i, c in ipairs(state.candidates) do
			if c.id == identifier then
				idx, problem = i, c
				break
			end
		end
	end

	if not problem then
		vim.notify("Theme-AC: candidate not found: " .. tostring(identifier), vim.log.levels.ERROR)
		return
	end

	table.remove(state.candidates, idx)
	local budget_seconds =
		M.compute_budget_seconds(problem.difficulty, state.current_rating or state.session_start_rating, state.session_mode)
	state.workspace[problem.id] = {
		problem = problem,
		start_time = os.time(),
		file_path = problem.id .. ".cpp",
		overtime = false,
		budget_seconds = budget_seconds,
	}
	state.problems_accepted = state.problems_accepted + 1

	-- Accountability Timer (Iteration 3): pooled, extensible deadline. Every
	-- accept adds this problem's own budget on top of whatever's already in
	-- the shared pool (or starts fresh from now if the pool was empty) -
	-- this is the intentional "positive carryover" behavior: accepting more
	-- problems always extends the shared runway. The guard above (Iteration
	-- 4) is what keeps this from being exploitable in the other direction.
	local now = os.time()
	state.pool_deadline = (state.pool_deadline or now) + budget_seconds

	vim.cmd("edit " .. vim.fn.fnameescape(config.practice_dir .. problem.id .. ".cpp"))
	vim.notify(
		string.format(
			"Theme-AC: accepted %s - %s (Diff:%d, +%dm budget, pool remaining: %s)",
			problem.id,
			problem.title,
			problem.difficulty,
			math.floor(budget_seconds / 60 + 0.5),
			M.format_duration_mmss(state.pool_deadline - now)
		),
		vim.log.levels.INFO
	)
end

-- Discards a candidate without accepting it (no history entry, no penalty -
-- it can reappear in future sessions per the plan's exclusion table).
function M.discard_problem(identifier)
	if not state.is_active then
		vim.notify("Theme-AC: no active session.", vim.log.levels.WARN)
		return
	end

	local idx = nil
	if type(identifier) == "number" then
		idx = identifier
	else
		for i, c in ipairs(state.candidates) do
			if c.id == identifier then
				idx = i
				break
			end
		end
	end

	if not idx or not state.candidates[idx] then
		vim.notify("Theme-AC: candidate not found: " .. tostring(identifier), vim.log.levels.ERROR)
		return
	end

	local removed = table.remove(state.candidates, idx)
	vim.notify("Theme-AC: discarded " .. removed.id, vim.log.levels.INFO)
end

-- ============================================================================
-- Verdict registration & session closure
-- ============================================================================

local VERDICT_OPTIONS = {
	{ value = "AC", label = "\u{2705} AC (Accepted)" },
	{ value = "AC_HINTS", label = "\u{1F4A1} AC (With Hints/Editorial)" },
	{ value = "WA", label = "\u{274C} WA (Wrong Answer)" },
	{ value = "TLE", label = "\u{23F1} TLE (Time Limit Exceeded)" },
	{ value = "MLE", label = "\u{1F4BE} MLE (Memory Limit Exceeded)" },
	{ value = "ABANDON", label = "\u{1F3F3}\u{FE0F} Abandon" },
}

-- Logs a verdict for an already-accepted (workspace) problem: computes
-- elapsed duration, calls `theme_ac.py verdict`, prints the rating-delta
-- notification, and removes the problem from the workspace on success.
-- on_complete (optional) is invoked after a successful log - used by
-- close_session() to chain multiple sequential abandon calls.
function M.log_verdict(problem_id, verdict, note, on_complete)
	local entry = state.workspace[problem_id]
	if not entry then
		vim.notify("Theme-AC: no active workspace entry for " .. tostring(problem_id), vim.log.levels.ERROR)
		return
	end

	local duration = os.time() - entry.start_time
	local args = {
		"verdict",
		"--problem",
		problem_id,
		"--result",
		verdict,
		"--duration",
		tostring(duration),
		"--note",
		note or "",
		"--mode",
		state.session_mode or config.default_session_mode,
	}
	if entry.budget_seconds then
		table.insert(args, "--budget")
		table.insert(args, tostring(entry.budget_seconds))
	end
	M.run_python(args, function(result, err)
		if err then
			vim.notify("Theme-AC: " .. err, vim.log.levels.ERROR)
			return
		end

		state.workspace[problem_id] = nil
		state.verdicts_logged = state.verdicts_logged + 1
		state.current_rating = result.rating_after

		-- Accountability Timer (Iteration 3): the pool is a single shared
		-- clock across everything unresolved. The instant the workspace
		-- empties, clear it to nil - this is what fully isolates the NEXT
		-- batch of accepts from whatever happened in this one, in both
		-- directions (no leftover deficit, no leftover surplus carries
		-- over), while still allowing free within-batch rationing.
		if vim.tbl_count(state.workspace) == 0 then
			state.pool_deadline = nil
			state.pool_overtime_notified = false
		end

		local sign = result.delta >= 0 and "+" or ""
		vim.notify(
			string.format(
				"\u{2714} Verdict Logged for %s | Rating: %d \u{2794} %d (%s%d)",
				problem_id,
				result.rating_before,
				result.rating_after,
				sign,
				result.delta
			),
			vim.log.levels.INFO
		)

		if on_complete then
			on_complete()
		end
	end)
end

local function pick_verdict(problem_id, callback)
	vim.ui.select(VERDICT_OPTIONS, {
		prompt = "Select Outcome for " .. problem_id .. ":",
		format_item = function(item)
			return item.label
		end,
	}, function(choice)
		if not choice then
			vim.notify("Theme-AC: verdict cancelled.", vim.log.levels.INFO)
			return
		end
		callback(choice.value)
	end)
end

-- How far PAST the shared pool deadline we currently are, in whole seconds.
-- Meaningful only once the pool is actually overtime (0 otherwise) - since
-- overtime is a POOLED property (Iteration 3/4), this is the same figure
-- for every currently-unresolved entry, not something computed per-entry.
local function get_pool_overtime_seconds()
	if not state.pool_deadline then
		return 0
	end
	return math.max(0, os.time() - state.pool_deadline)
end

-- Iteration 5: the one gate every verdict-resolution path (manual prompt,
-- session close, competitive-end cascade) MUST go through. If the entry is
-- flagged overtime, the real AC/WA/etc. menu is never shown - the ONLY
-- outcome available is a single yes/no confirmation that plainly states
-- "this will record as DNF" before anything is logged. Nothing here ever
-- logs without that explicit confirmation.
local function confirm_forced_dnf(problem_id, prompt_prefix, on_yes, on_no)
	local overtime_str = M.format_duration_mmss(get_pool_overtime_seconds())
	local choice = vim.fn.confirm(
		string.format("%s '%s'? (Overtime by %s) - this will record as DNF.", prompt_prefix, problem_id, overtime_str),
		"&Yes\n&No",
		2
	)
	if choice == 1 then
		on_yes()
	else
		on_no()
	end
end

-- Interactive verdict flow: auto-detects the problem from the current buffer
-- name if it matches a workspace entry; otherwise falls back to vim.ui.select.
-- on_done (optional) fires after a successful log - used by dashboard.lua to
-- re-render after a verdict, not fired on cancellation.
function M.verdict_prompt(on_done)
	if not state.is_active then
		vim.notify("Theme-AC: no active session.", vim.log.levels.WARN)
		return
	end

	local ids = vim.tbl_keys(state.workspace)
	if #ids == 0 then
		vim.notify("Theme-AC: workspace is empty - nothing to log a verdict for.", vim.log.levels.WARN)
		return
	end

	local function proceed(problem_id)
		local entry = state.workspace[problem_id]
		if entry and entry.overtime then
			confirm_forced_dnf(problem_id, "Log DNF for", function()
				local note = vim.fn.input("Insight (optional): ")
				M.log_verdict(problem_id, "DNF", note, on_done)
			end, function()
				vim.notify("Theme-AC: verdict cancelled.", vim.log.levels.INFO)
			end)
			return
		end

		pick_verdict(problem_id, function(verdict)
			local note = vim.fn.input("Insight (optional): ")
			M.log_verdict(problem_id, verdict, note, on_done)
		end)
	end

	-- Auto-context detection: does the current buffer match a workspace problem?
	local current_file = vim.fn.expand("%:t:r")
	if state.workspace[current_file] then
		proceed(current_file)
		return
	end

	if #ids == 1 then
		proceed(ids[1])
		return
	end

	vim.ui.select(ids, {
		prompt = "Select Problem for Verdict:",
		format_item = function(id)
			return string.format("%s (Elapsed: %s)", id, M.get_elapsed(state.workspace[id]))
		end,
	}, function(choice)
		if not choice then
			vim.notify("Theme-AC: verdict cancelled.", vim.log.levels.INFO)
			return
		end
		proceed(choice)
	end)
end

-- Sequentially prompts to resolve each still-unresolved workspace entry.
-- Non-overtime entries get the original "Abandon?" prompt (-> ABANDON,
-- half-K, mode-independent). Overtime entries get the forced-DNF
-- confirmation instead (-> DNF, full-K in contest mode / half-K in study
-- mode) - this is what closes the leakage where walking out via session
-- close could otherwise dodge DNF for the gentler ABANDON. Any single "No"
-- cancels the entire close - session remains fully active with that
-- problem still tracked (per the plan's Epic 5 close flow).
local function close_session_step(remaining_ids, on_done, on_cancel)
	if #remaining_ids == 0 then
		on_done()
		return
	end

	local id = table.remove(remaining_ids, 1)
	local entry = state.workspace[id]
	if not entry then
		close_session_step(remaining_ids, on_done, on_cancel)
		return
	end

	if entry.overtime then
		confirm_forced_dnf(id, "Log DNF for", function()
			M.log_verdict(id, "DNF", "", function()
				close_session_step(remaining_ids, on_done, on_cancel)
			end)
		end, function()
			on_cancel(id)
		end)
		return
	end

	local elapsed = M.get_elapsed(entry)
	local choice =
		vim.fn.confirm(string.format("Abandon active problem '%s'? (Elapsed: %s)", id, elapsed), "&Yes\n&No", 2)

	if choice == 1 then
		M.log_verdict(id, "ABANDON", "", function()
			close_session_step(remaining_ids, on_done, on_cancel)
		end)
	else
		on_cancel(id)
	end
end

-- Closes the Theme-AC session: prompts to abandon each unresolved workspace
-- problem, silently discards untouched candidates (no penalty), then clears
-- state and displays a session summary. The competitive session and open
-- buffers are never touched.
function M.close_session(dashboard_on_done)
	if not state.is_active then
		vim.notify("Theme-AC: no active session.", vim.log.levels.WARN)
		return
	end

	local ids = vim.tbl_keys(state.workspace)
	close_session_step(ids, function()
		-- Fetch final rating for the session summary
		M.run_python({ "stats" }, function(stats, _)
			local duration = os.time() - (state.session_start_time or os.time())
			local start_rating = state.session_start_rating or 0
			local end_rating = (stats and stats.current_rating) or start_rating
			local delta = end_rating - start_rating
			local sign = delta >= 0 and "+" or ""

			local summary = {
				string.format("Theme-AC Session Complete (%s)", format_session_duration(duration)),
				string.format("  Accepted: %d   Verdicts: %d", state.problems_accepted, state.verdicts_logged),
				string.format("  Rating: %d \u{2794} %d (%s%d)", start_rating, end_rating, sign, delta),
			}

			state.is_active = false
			state.candidates = {}
			state.workspace = {}
			state.session_start_time = nil
			state.session_start_rating = nil
			state.problems_accepted = 0
			state.verdicts_logged = 0
			state.session_mode = nil
			state.current_rating = nil
			state.pool_deadline = nil
			state.pool_overtime_notified = false
			stop_overtime_timer()

			vim.notify(table.concat(summary, "\n"), vim.log.levels.INFO)
			if dashboard_on_done then
				dashboard_on_done()
			end
		end)
	end, function(cancelled_id)
		vim.notify(
			"Theme-AC: close cancelled - '" .. cancelled_id .. "' remains tracked. Session still active.",
			vim.log.levels.WARN
		)
		if dashboard_on_done then
			dashboard_on_done()
		end
	end)
end

-- Read-only accessor for the dashboard and external inspection.
function M.get_state()
	return state
end

-- ============================================================================
-- Cascade hook: ending the COMPETITIVE session should also prompt to close
-- any active Theme-AC session, using the same interactive close_session()
-- flow a manual 'X'/:ThemeACClose would use.
--
-- Ordering note: vim.fn.confirm() is synchronous/blocking, but the "Yes"
-- branch's log_verdict() call is async, so close_session()'s recursive
-- chain resumes across event-loop ticks rather than blocking end_session()
-- until every prompt is fully resolved. Practically: competitive's own
-- teardown can appear before later per-problem prompts finish. This is a
-- cosmetic ordering quirk, not a correctness issue.
-- ============================================================================

local function auto_close_on_competitive_end()
	if not state.is_active then
		return
	end
	vim.notify("Theme-AC: competitive session ending - resolving in-progress problem(s)...", vim.log.levels.WARN)
	M.close_session()
end

-- Wraps competitive.init.end_session exactly once, the first time THIS
-- module is required. Guarded by competitive_init.is_active so a no-op
-- end_session() call never spuriously fires the cascade.
do
	local competitive_init = require("competitive.init")
	if not competitive_init.__theme_ac_end_session_wrapped then
		local original_end_session = competitive_init.end_session
		competitive_init.end_session = function(...)
			if competitive_init.is_active then
				auto_close_on_competitive_end()
			end
			return original_end_session(...)
		end
		competitive_init.__theme_ac_end_session_wrapped = true
	end
end

return M
