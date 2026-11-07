-- ~/.config/nvim/lua/competitive/theme_ac/dashboard.lua
-- Floating window dashboard UI - a pure VIEW layer over the already-validated
-- theme_ac state machine (init.lua). Follows the same floating-window
-- pattern as core/ui.lua's FloatingTerminal (scratch buffer + centered
-- nvim_open_win, winblend=0 for transparency).
--
-- Nothing in this file mutates Theme-AC state directly - every keybinding
-- delegates to a function already implemented and manually verified in
-- MVP 1/2 (open_session, accept_problem, discard_problem, reroll_candidates,
-- verdict_prompt, close_session). This file only renders + maps keys.

local M = {}

local TAB_ORDER = { "candidates", "workspace", "graph" }

local dash = {
	buf = nil,
	win = nil,
	ns = nil,
	prev_win = nil, -- window that was focused right before the float opened
	session_origin = nil, -- "fresh" | "resumed" - which branch the last toggle() took, for the header label
	active_tab = "candidates", -- "candidates" | "workspace" | "graph"
	rating = nil, -- last known rating, seeded/refreshed via `theme_ac.py stats`
	history_points = nil, -- last known full history.json, refreshed alongside rating
	line_map = {}, -- 1-based buffer line -> { kind = "candidate"|"workspace", ... }
	refresh_timer = nil, -- live ticker, runs whenever the dashboard window is open (any tab)
}

-- ============================================================================
-- Highlight groups - linked (not hardcoded hex) so they always match
-- whichever gruvbox variant/contrast is active, per the plan's requirement.
-- ============================================================================

local function setup_highlights()
	-- vim.api.nvim_set_hl(0, "ThemeACDiffEasy", { ctermfg = 142, fg = "#b8bb26", default = true }) -- green
	-- vim.api.nvim_set_hl(0, "ThemeACDiffMedium", { ctermfg = 214, fg = "#fabd2f", default = true }) -- yellow
	-- vim.api.nvim_set_hl(0, "ThemeACDiffHard", { ctermfg = 167, fg = "#fb4934", default = true }) -- red
	local links = {
		ThemeACHeader = "Title",
		ThemeACTabActive = "Function",
		ThemeACTabInactive = "Comment",
		ThemeACDiffEasy = "String",
		ThemeACDiffMedium = "WarningMsg",
		ThemeACDiffHard = "ErrorMsg",
		ThemeACUpsolve = "Special",
		ThemeACTimer = "Number",
		ThemeACFooter = "NonText",
		ThemeACGraphLine = "Special",
		-- Iteration 6: pool countdown/overtime header display.
		ThemeACPoolNormal = "Number",
		ThemeACPoolWarning = "WarningMsg",
		ThemeACPoolOvertime = "ErrorMsg",
	}
	for name, link in pairs(links) do
		vim.api.nvim_set_hl(0, name, { link = link, default = true })
	end
end

local function difficulty_hl(difficulty, rating)
	if not rating then
		return "ThemeACDiffMedium"
	end
	if difficulty < rating - 100 then
		return "ThemeACDiffEasy"
	elseif difficulty > rating + 100 then
		return "ThemeACDiffHard"
	end
	return "ThemeACDiffMedium"
end

-- Formats theme_ac.py's estimated_seconds (approximate, from Kenkoooo's own
-- time-to-solve regression - see estimate_solve_seconds() in theme_ac.py)
-- into a short "~Nm"/"~Nh NNm" label. Returns "" when no estimate is
-- available (most problems lack a fitted time model - insufficient sample).
local function format_estimate(seconds)
	if not seconds then
		return ""
	end
	if seconds < 60 then
		return string.format("~%ds", seconds)
	end
	local total_minutes = math.floor(seconds / 60)
	if total_minutes < 60 then
		return string.format("~%dm", total_minutes)
	end
	local hours = math.floor(total_minutes / 60)
	local minutes = total_minutes % 60
	return string.format("~%dh%02dm", hours, minutes)
end

-- Formats a duration in seconds for the upsolve detail line.
local function format_duration_short(seconds)
	if not seconds then
		return ""
	end
	local m = math.floor(seconds / 60)
	if m == 0 then
		return string.format("%ds", seconds)
	end
	return string.format("%dm", m)
end

-- Iteration 6: formats the Accountability Timer's mode label + live pool
-- countdown/overtime for the dashboard header. Returns (text, hl_group).
-- hl_group is nil when there's nothing timer-related to color (no session
-- mode chosen yet, i.e. before the very first open_session()).
local function format_pool_status(st)
	if not st.session_mode then
		return "", nil
	end
	local mode_label = st.session_mode == "study" and "Study" or "Contest"
	local ac = require("competitive.theme_ac")

	if not st.pool_deadline then
		return string.format("[%s]", mode_label), nil
	end

	local now = os.time()
	if now < st.pool_deadline then
		local remaining = st.pool_deadline - now
		local hl = (remaining <= 300) and "ThemeACPoolWarning" or "ThemeACPoolNormal"
		return string.format("[%s]  \u{23F1} %s", mode_label, ac.format_duration_mmss(remaining)), hl
	end

	local overtime = now - st.pool_deadline
	return string.format("[%s]  \u{23F0} +%s OVERTIME", mode_label, ac.format_duration_mmss(overtime)),
		"ThemeACPoolOvertime"
end

-- ============================================================================
-- Live ticker - runs whenever the dashboard window is open, on ANY tab
-- (Iteration 6: the header's pool countdown/overtime needs to stay live
-- regardless of which tab is focused, not just the workspace tab's
-- per-entry elapsed timers).
-- ============================================================================

local function stop_refresh_timer()
	if dash.refresh_timer then
		dash.refresh_timer:stop()
		dash.refresh_timer:close()
		dash.refresh_timer = nil
	end
end

local function start_refresh_timer()
	stop_refresh_timer()
	local uv = vim.uv or vim.loop
	dash.refresh_timer = uv.new_timer()
	dash.refresh_timer:start(1000, 1000, function()
		vim.schedule(function()
			if dash.win and vim.api.nvim_win_is_valid(dash.win) then
				M.render()
			else
				stop_refresh_timer()
			end
		end)
	end)
end

-- ============================================================================
-- Rendering
-- ============================================================================

local SEPARATOR = string.rep("\u{2500}", 60)

local function render_candidates_tab(st, lines, hls)
	if #st.candidates == 0 then
		table.insert(lines, "  (no candidates - press 'r' to roll, or check :messages for sync errors)")
	else
		for i, c in ipairs(st.candidates) do
			local marker = c.is_upsolve and "\u{27F3}" or (c.is_experimental and "\u{26A0}" or " ")
			local estimate = format_estimate(c.estimated_seconds)
			table.insert(
				lines,
				string.format(" %s %-16s Diff:%-5d Est:%-7s %s", marker, c.id, c.difficulty, estimate, c.title)
			)
			dash.line_map[#lines] = { kind = "candidate", index = i, problem = c }
			table.insert(hls, {
				line = #lines - 1,
				col_start = 0,
				col_end = -1,
				group = difficulty_hl(c.difficulty, dash.rating),
			})
			-- Surface previous attempt context for upsolve candidates
			if c.is_upsolve and c.previous_verdict then
				local note_part = (c.previous_note and c.previous_note ~= "") and (" \u{2014} " .. c.previous_note)
					or ""
				local dur_part = c.previous_duration
						and string.format(" (%s)", format_duration_short(c.previous_duration))
					or ""
				table.insert(
					lines,
					string.format("   \u{2514}\u{2500} Previous: %s%s%s", c.previous_verdict, dur_part, note_part)
				)
				table.insert(hls, { line = #lines - 1, col_start = 0, col_end = -1, group = "ThemeACUpsolve" })
			end
		end
	end
	table.insert(lines, SEPARATOR)
	table.insert(lines, " [a]ccept  [o]pen url  [d]iscard  [r]e-roll (prompts count)")
	table.insert(lines, " [Tab] switch tab   [q] hide   [X] end session")
	table.insert(hls, { line = #lines - 2, col_start = 0, col_end = -1, group = "ThemeACFooter" })
	table.insert(hls, { line = #lines - 1, col_start = 0, col_end = -1, group = "ThemeACFooter" })
end

local function render_workspace_tab(st, lines, hls)
	local ac = require("competitive.theme_ac")
	local ids = vim.tbl_keys(st.workspace)
	table.sort(ids)

	if #ids == 0 then
		table.insert(lines, "  (workspace is empty)")
	else
		for _, id in ipairs(ids) do
			local entry = st.workspace[id]
			table.insert(
				lines,
				string.format(" %-16s \u{23F1} %-10s %s", id, ac.get_elapsed(entry), entry.problem.title)
			)
			dash.line_map[#lines] = { kind = "workspace", id = id, entry = entry }
			table.insert(hls, { line = #lines - 1, col_start = 0, col_end = -1, group = "ThemeACTimer" })
		end
	end
	table.insert(lines, SEPARATOR)
	table.insert(lines, " [o]pen buffer  [v]erdict  [Tab] switch tab")
	table.insert(lines, " [q] hide   [X] end session")
	table.insert(hls, { line = #lines - 2, col_start = 0, col_end = -1, group = "ThemeACFooter" })
	table.insert(hls, { line = #lines - 1, col_start = 0, col_end = -1, group = "ThemeACFooter" })
end

-- Renders a simple ASCII line chart of `values` (chronological numbers) into
-- `height` rows of `width` columns. Returns (lines, y_min, y_max); lines[1]
-- is the TOP row.
--
-- When there are more raw points than columns, buckets consecutive points
-- per column and tracks BOTH the min and max within each bucket (not just a
-- single nearest-neighbor sample) - drawn as a short vertical span in that
-- column - so a real spike/crash sandwiched between two sampled columns is
-- still visible as a range rather than silently disappearing. The bucket's
-- LAST raw value (an actual observed data point, not an average) is used to
-- draw the connecting trend line between columns, same staircase style as
-- before ("|" spanning rows, "-" where two consecutive columns land on the
-- same row).
local function render_line_chart(values, width, height)
	local n = #values
	if n == 0 then
		return { "  (no rating history yet)" }, nil, nil
	end
	if n == 1 then
		return { string.format("  (only one data point so far: %d)", values[1]) }, values[1], values[1]
	end

	-- Per-column bucket stats: bmin/bmax (full range within the bucket) and
	-- blast (last raw value - used for the connecting trend line).
	local bmin, bmax, blast
	if n > width then
		bmin, bmax, blast = {}, {}, {}
		local step = n / width
		for i = 0, width - 1 do
			local lo = math.floor(i * step) + 1
			local hi = math.floor((i + 1) * step)
			if hi < lo then
				hi = lo
			end
			if hi > n then
				hi = n
			end
			local mn, mx = values[lo], values[lo]
			for j = lo, hi do
				local v = values[j]
				if v < mn then
					mn = v
				end
				if v > mx then
					mx = v
				end
			end
			bmin[i + 1] = mn
			bmax[i + 1] = mx
			blast[i + 1] = values[hi]
		end
		n = width
	else
		bmin, bmax, blast = {}, {}, {}
		for i, v in ipairs(values) do
			bmin[i] = v
			bmax[i] = v
			blast[i] = v
		end
	end

	local y_min, y_max = bmin[1], bmax[1]
	for i = 1, n do
		if bmin[i] < y_min then
			y_min = bmin[i]
		end
		if bmax[i] > y_max then
			y_max = bmax[i]
		end
	end
	if y_min == y_max then
		y_min = y_min - 1
		y_max = y_max + 1
	end

	local function row_of(v)
		return math.floor((y_max - v) / (y_max - y_min) * (height - 1) + 0.5)
	end

	local grid = {}
	for r = 1, height do
		grid[r] = {}
		for c = 1, n do
			grid[r][c] = " "
		end
	end

	-- Draw each column's min/max range as a vertical span first (so the
	-- trend line/markers drawn afterwards remain visible on top of it).
	for c = 1, n do
		local lo_row, hi_row = row_of(bmax[c]), row_of(bmin[c])
		for r = lo_row, hi_row do
			grid[r + 1][c] = "\u{2502}" -- │
		end
	end

	local prev_row = row_of(blast[1])
	grid[prev_row + 1][1] = "\u{25CF}" -- ●
	for c = 2, n do
		local cur_row = row_of(blast[c])
		local lo, hi = math.min(cur_row, prev_row), math.max(cur_row, prev_row)
		for r = lo, hi do
			grid[r + 1][c] = "\u{2502}" -- │
		end
		if cur_row == prev_row then
			grid[cur_row + 1][c] = "\u{2500}" -- ─
		end
		prev_row = cur_row
	end

	local out = {}
	for r = 1, height do
		table.insert(out, table.concat(grid[r]))
	end
	return out, y_min, y_max
end

local function render_graph_tab(lines, hls)
	local entries = dash.history_points or {}

	if #entries == 0 then
		table.insert(lines, "  (no verdict history yet - solve a problem to start your rating graph)")
		table.insert(lines, SEPARATOR)
		table.insert(lines, " [Tab] switch tab   [q] hide   [X] end session")
		table.insert(hls, { line = #lines - 1, col_start = 0, col_end = -1, group = "ThemeACFooter" })
		return
	end

	-- history.json is append-only/chronological. Prepend the very first
	-- entry's rating_before as the true starting point of the series.
	local series = { entries[1].rating_before }
	for _, e in ipairs(entries) do
		table.insert(series, e.rating_after)
	end

	local width = 60
	if dash.win and vim.api.nvim_win_is_valid(dash.win) then
		width = math.max(20, vim.api.nvim_win_get_width(dash.win) - 4)
	end

	local chart_lines, y_min, y_max = render_line_chart(series, width, 10)
	local chart_start_line = #lines
	for _, line in ipairs(chart_lines) do
		table.insert(lines, " " .. line)
	end
	for i = chart_start_line, #lines - 1 do
		table.insert(hls, { line = i, col_start = 0, col_end = -1, group = "ThemeACGraphLine" })
	end

	table.insert(lines, "")
	table.insert(
		lines,
		string.format(
			" Range: %d \u{2013} %d    Points: %d    Latest: %d",
			y_min or 0,
			y_max or 0,
			#series,
			series[#series]
		)
	)
	table.insert(lines, SEPARATOR)
	table.insert(lines, " [Tab] switch tab   [q] hide   [X] end session")
	table.insert(hls, { line = #lines - 1, col_start = 0, col_end = -1, group = "ThemeACFooter" })
end

-- Re-renders the active tab's content into the dashboard buffer. Safe to
-- call any time the window may or may not be open (no-ops if buf is gone).
function M.render()
	if not (dash.buf and vim.api.nvim_buf_is_valid(dash.buf)) then
		return
	end

	local ac = require("competitive.theme_ac")
	local st = ac.get_state()

	local lines = {}
	local hls = {}
	dash.line_map = {}

	local rating_label = dash.rating and tostring(dash.rating) or "?"
	local origin_label = ""
	if dash.session_origin == "fresh" then
		origin_label = "  [\u{2728} freshly pulled]"
	elseif dash.session_origin == "resumed" then
		origin_label = "  [\u{21BB} resumed existing session]"
	end

	-- Iteration 6: mode label + live pool countdown/overtime, appended after
	-- the rating/origin segment. Highlighted separately from ThemeACHeader
	-- so its color can reflect normal/warning/overtime state.
	local pool_text, pool_hl = format_pool_status(st)
	local header_prefix = string.format(" Theme-AC \u{2014} Rating: %s%s  ", rating_label, origin_label)
	table.insert(lines, header_prefix .. pool_text)
	table.insert(hls, { line = 0, col_start = 0, col_end = #header_prefix, group = "ThemeACHeader" })
	if pool_hl then
		table.insert(hls, { line = 0, col_start = #header_prefix, col_end = -1, group = pool_hl })
	end

	local labels = {
		candidates = string.format("Candidates (%d)", #st.candidates),
		workspace = string.format("Workspace (%d)", vim.tbl_count(st.workspace)),
		graph = "Graph",
	}
	local active_marker, inactive_marker = " \u{25B8} ", "   "
	local gap = "   "

	local parts = {}
	for _, name in ipairs(TAB_ORDER) do
		local marker = dash.active_tab == name and active_marker or inactive_marker
		table.insert(parts, marker .. labels[name])
	end
	table.insert(lines, table.concat(parts, gap))

	local col = 0
	for i, name in ipairs(TAB_ORDER) do
		local part_len = #parts[i]
		table.insert(hls, {
			line = 1,
			col_start = col,
			col_end = (i == #TAB_ORDER) and -1 or (col + part_len),
			group = dash.active_tab == name and "ThemeACTabActive" or "ThemeACTabInactive",
		})
		col = col + part_len + #gap
	end

	table.insert(lines, SEPARATOR)

	if dash.active_tab == "candidates" then
		render_candidates_tab(st, lines, hls)
	elseif dash.active_tab == "workspace" then
		render_workspace_tab(st, lines, hls)
	else
		render_graph_tab(lines, hls)
	end

	vim.bo[dash.buf].modifiable = true
	vim.api.nvim_buf_set_lines(dash.buf, 0, -1, false, lines)
	vim.bo[dash.buf].modifiable = false

	if not dash.ns then
		dash.ns = vim.api.nvim_create_namespace("ThemeACDashboard")
	end
	vim.api.nvim_buf_clear_namespace(dash.buf, dash.ns, 0, -1)
	for _, hl in ipairs(hls) do
		vim.api.nvim_buf_add_highlight(dash.buf, dash.ns, hl.group, hl.line, hl.col_start, hl.col_end)
	end
end

-- Fetches the latest rating AND full verdict history from the Python
-- backend, then renders. Used whenever displayed data might be stale (open,
-- post-verdict, switching to the Graph tab). Two sequential Python calls
-- (not parallel) - cheap for a personal-use ledger, and avoids any chance of
-- overlapping reads while a concurrent write is in flight.
local function refresh_all_and_render()
	local ac = require("competitive.theme_ac")
	local config = require("competitive.theme_ac.config")
	ac.run_python({ "stats" }, function(stats_result, stats_err)
		if not stats_err and stats_result then
			dash.rating = stats_result.current_rating
		end
		ac.run_python({ "history", "--last", tostring(config.graph_history_limit) }, function(history_result, history_err)
			if not history_err and history_result then
				dash.history_points = history_result
			end
			M.render()
		end)
	end)
end

-- Lighter variant: only fetches the current rating (not full history).
-- Used by M.open() for tabs OTHER than "graph" (candidates/workspace don't
-- display history at all, so fetching it there would be wasted work).
local function refresh_rating_and_render()
	local ac = require("competitive.theme_ac")
	ac.run_python({ "stats" }, function(result, err)
		if not err and result then
			dash.rating = result.current_rating
		end
		M.render()
	end)
end

-- Public, best-effort refresh: pulls fresh rating+history from the Python
-- backend and re-renders, but ONLY if the dashboard buffer currently
-- exists - a true no-op (no subprocess spawned at all) if the dashboard has
-- never been opened this Neovim session, since M.open()'s own graph-tab
-- branch (see below) will already do a full fetch whenever it's next
-- opened. Used by commands.lua so :ThemeACVerdict/<leader>av (which may be
-- invoked from OUTSIDE the dashboard, e.g. from within a .cpp buffer) keeps
-- an already-open dashboard's rating/history immediately in sync, without
-- forcing the user to manually flip tabs away and back to see it.
function M.refresh_if_open()
	if dash.buf and vim.api.nvim_buf_is_valid(dash.buf) then
		refresh_all_and_render()
	end
end

-- ============================================================================
-- Cursor -> problem/workspace-entry lookup (used by keybindings)
-- ============================================================================

function M.get_cursor_problem()
	if not (dash.win and vim.api.nvim_win_is_valid(dash.win)) then
		return nil
	end
	local row = vim.api.nvim_win_get_cursor(dash.win)[1]
	return dash.line_map[row]
end

-- ============================================================================
-- Tab switching
-- ============================================================================

function M.set_tab(name)
	if name ~= "candidates" and name ~= "workspace" and name ~= "graph" then
		return
	end
	dash.active_tab = name
	-- Iteration 6: the ticker now runs on every tab (header pool countdown
	-- needs to stay live regardless of focus), not just "workspace".
	start_refresh_timer()
	if name == "graph" then
		-- History doesn't change every second like the workspace timer does -
		-- a fresh fetch on tab-entry (rather than a periodic ticker) is enough.
		refresh_all_and_render()
	else
		M.render()
	end
end

local function toggle_tab()
	local current_index = 1
	for i, name in ipairs(TAB_ORDER) do
		if name == dash.active_tab then
			current_index = i
			break
		end
	end
	M.set_tab(TAB_ORDER[(current_index % #TAB_ORDER) + 1])
end

-- ============================================================================
-- Buffer-local keybindings (set once, when the scratch buffer is created)
-- ============================================================================

local function open_in_browser(url)
	-- wslview (from the `wslu` package) is the plan's resolved WSL
	-- browser-open command, but it may not be installed. jobstart() throws
	-- a hard error (not a soft failure) if the given command isn't
	-- executable, so we must check vim.fn.executable() first - and fall
	-- back through a chain of alternatives that all work from inside WSL
	-- without requiring any extra package, before finally falling back to
	-- just copying the URL to the clipboard so the user is never stuck.
	local candidates = {
		{ "wslview", url },
		{ "xdg-open", url },
		{ "cmd.exe", "/c", "start", "", url },
		{ "powershell.exe", "-NoProfile", "-Command", "Start-Process", url },
	}

	for _, cmd in ipairs(candidates) do
		if vim.fn.executable(cmd[1]) == 1 then
			vim.fn.jobstart(cmd, { detach = true })
			vim.notify("Theme-AC: opening " .. url, vim.log.levels.INFO)
			return
		end
	end

	vim.fn.setreg("+", url)
	vim.notify(
		"Theme-AC: no browser-opener found (tried wslview/xdg-open/cmd.exe/powershell.exe).\n"
			.. "URL copied to clipboard instead: "
			.. url
			.. "\nInstall wslu for the intended flow: sudo apt install wslu",
		vim.log.levels.WARN
	)
end

-- Prompts for how many candidates to pull, pre-filled with the current
-- default so pressing <CR> alone keeps the usual count. Uses vim.ui.input
-- (async) rather than vim.fn.input (synchronous) to avoid a deadlock when
-- called from within a which-key dispatch - which-key's popup float may
-- still be tearing down when the callback fires, and a synchronous input()
-- in that window steals focus before cleanup is complete, freezing the UI.
local function prompt_candidate_count(callback)
	vim.ui.input({
		prompt = "Number of candidates to pull: ",
		default = tostring(require("competitive.theme_ac.config").default_candidate_count),
	}, function(raw)
		if not raw or raw == "" then
			vim.notify("Theme-AC: cancelled.", vim.log.levels.INFO)
			return
		end
		local count = tonumber(raw)
		if not count or count ~= math.floor(count) or count < 1 then
			vim.notify(
				"Theme-AC: invalid count '" .. raw .. "' - must be a positive whole number.",
				vim.log.levels.ERROR
			)
			return
		end
		callback(count)
	end)
end

-- Prompts for Contest vs Study mode, once per fresh session (mode is fixed
-- for the session's whole lifetime - see init.lua's state.session_mode).
-- Contest: tighter budgets, DNF costs full K. Study: looser budgets, DNF
-- costs half K (deliberate deep-dives shouldn't be punished at full
-- strength). Defaults to "contest" on cancel-equivalent (Escape has no
-- natural default here, so we simply re-notify and let the caller retry).
local function prompt_session_mode(callback)
	vim.ui.select({
		{ value = "contest", label = "Contest  (tighter budgets, DNF = full penalty)" },
		{ value = "study", label = "Study    (looser budgets, DNF = half penalty)" },
	}, {
		prompt = "Theme-AC session mode:",
		format_item = function(item)
			return item.label
		end,
	}, function(choice)
		if not choice then
			vim.notify("Theme-AC: cancelled.", vim.log.levels.INFO)
			return
		end
		callback(choice.value)
	end)
end

local function setup_keymaps(buf)
	local ac = require("competitive.theme_ac")
	local config = require("competitive.theme_ac.config")
	local opts = { buffer = buf, nowait = true, silent = true }
	local function map(lhs, fn)
		vim.keymap.set("n", lhs, fn, opts)
	end

	map("<Tab>", toggle_tab)
	map("q", M.close)
	map("<Esc>", M.close)

	map("X", function()
		ac.close_session(function()
			M.close()
		end)
	end)

	map("a", function()
		local sel = M.get_cursor_problem()
		if not (sel and sel.kind == "candidate") then
			return
		end
		-- accept_problem() does `:edit {id}.cpp` in whatever window is
		-- "current" at call time. Since the dashboard float stays open and
		-- focused on accept (unlike the workspace "o"/<CR> flow, which
		-- closes the float first), we must redirect that edit to the window
		-- that was active BEFORE the float opened - otherwise the .cpp
		-- buffer loads INSIDE the floating window itself, clobbering the
		-- dashboard's own display.
		if dash.prev_win and vim.api.nvim_win_is_valid(dash.prev_win) then
			vim.api.nvim_win_call(dash.prev_win, function()
				ac.accept_problem(sel.problem.id)
			end)
		else
			ac.accept_problem(sel.problem.id)
		end
		M.render()
	end)

	map("d", function()
		local sel = M.get_cursor_problem()
		if sel and sel.kind == "candidate" then
			ac.discard_problem(sel.problem.id)
			M.render()
		end
	end)

	map("r", function()
		if dash.active_tab ~= "candidates" then
			return
		end
		prompt_candidate_count(function(count)
			ac.reroll_candidates(count, function()
				dash.session_origin = "fresh"
				M.render()
			end)
		end)
	end)

	local function open_selection()
		local sel = M.get_cursor_problem()
		if not sel then
			return
		end
		if sel.kind == "candidate" then
			open_in_browser(sel.problem.url)
		elseif sel.kind == "workspace" then
			M.close()
			vim.cmd("edit " .. vim.fn.fnameescape(config.practice_dir .. sel.id .. ".cpp"))
		end
	end
	map("o", open_selection)
	map("<CR>", open_selection)

	map("v", function()
		local sel = M.get_cursor_problem()
		if not sel or sel.kind ~= "workspace" then
			return
		end
		ac.verdict_prompt(function()
			refresh_all_and_render()
		end)
	end)
end

-- ============================================================================
-- Window/buffer lifecycle
-- ============================================================================

local function create_window()
	local width = math.floor(vim.o.columns * 0.7)
	local height = math.floor(vim.o.lines * 0.6)
	local row = math.floor((vim.o.lines - height) / 2)
	local col = math.floor((vim.o.columns - width) / 2)

	dash.win = vim.api.nvim_open_win(dash.buf, true, {
		relative = "editor",
		width = width,
		height = height,
		row = row,
		col = col,
		style = "minimal",
		border = "rounded",
	})
	vim.wo[dash.win].winblend = 0
	vim.wo[dash.win].wrap = false
	vim.wo[dash.win].cursorline = true
	vim.wo[dash.win].winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder"
end

-- Opens the dashboard window (creating the scratch buffer on first use).
-- Does NOT start/require a Theme-AC session - callers (toggle()) are
-- responsible for that, matching the plan's separation between the session
-- state machine and the pure-view dashboard.
function M.open()
	setup_highlights()

	dash.prev_win = vim.api.nvim_get_current_win()

	if not (dash.buf and vim.api.nvim_buf_is_valid(dash.buf)) then
		dash.buf = vim.api.nvim_create_buf(false, true)
		vim.bo[dash.buf].buftype = "nofile"
		vim.bo[dash.buf].bufhidden = "hide"
		vim.bo[dash.buf].swapfile = false
		vim.bo[dash.buf].filetype = "themeac"
		setup_keymaps(dash.buf)
	end

	create_window()

	-- Iteration 6: ticker runs regardless of which tab is active, so the
	-- header's pool countdown/overtime stays live no matter what you're
	-- looking at.
	start_refresh_timer()

	-- Bugfix: previously always called refresh_rating_and_render() (rating
	-- only), relying on a false assumption that "the graph tab triggers its
	-- own full refresh elsewhere" - true when reached via set_tab("graph")
	-- on an ALREADY-open dashboard, but never true for a cold open landing
	-- directly on the graph tab (show_graph() with no window yet, or
	-- toggle() resuming a session whose dash.active_tab was left on
	-- "graph" from a previous visit) - dash.history_points would stay nil
	-- forever in that case, rendering as "no verdict history yet" even
	-- with a populated history.json on disk.
	if dash.active_tab == "graph" then
		refresh_all_and_render()
	else
		refresh_rating_and_render()
	end
end

-- Hides the dashboard window WITHOUT touching the Theme-AC session - state
-- (candidates/workspace/timers) persists exactly as-is until reopened.
function M.close()
	stop_refresh_timer()
	if dash.win and vim.api.nvim_win_is_valid(dash.win) then
		vim.api.nvim_win_close(dash.win, false)
	end
	dash.win = nil
end

-- Opens the dashboard if closed, closes it if open. On first-ever open (no
-- Theme-AC session active yet), prompts for how many candidates to pull,
-- then transparently starts a session via open_session() and only opens the
-- window once that async fetch resolves (or once the guard-clause warning
-- has already fired, in which case open_session simply never invokes the
-- callback and no window appears). If a session is already active, reopens
-- immediately showing the EXISTING pool - dash.session_origin records which
-- case happened so render() can label the header accordingly.
function M.toggle()
	if dash.win and vim.api.nvim_win_is_valid(dash.win) then
		M.close()
		return
	end

	local ac = require("competitive.theme_ac")
	if not ac.get_state().is_active then
		prompt_candidate_count(function(count)
			prompt_session_mode(function(mode)
				ac.open_session(count, mode, function()
					dash.session_origin = "fresh"
					-- Seed rating before opening so the first render() has a valid
					-- value for difficulty_hl coloring (refresh_rating_and_render
					-- inside M.open() will update it async, but we need a non-nil
					-- value NOW to avoid the all-same-color fallback).
					dash.rating = ac.get_state().session_start_rating
					M.open()
				end)
			end)
		end)
	else
		dash.session_origin = "resumed"
		M.open()
	end
end

-- Jumps straight to the rating-graph tab, opening the dashboard window if
-- needed. Deliberately does NOT go through toggle()'s open_session guard -
-- your rating history is meaningful whether or not a Theme-AC session is
-- currently active (M.open() itself has no such requirement either).
function M.show_graph()
	if dash.win and vim.api.nvim_win_is_valid(dash.win) then
		M.set_tab("graph") -- already open: switch tab (fetches once via set_tab)
	else
		dash.active_tab = "graph" -- not open yet: pre-set so open()'s graph
		M.open() -- branch (see above) does the full stats+history fetch
	end
end

return M
