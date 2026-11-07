-- ~/.config/nvim/lua/competitive/arena/dashboard.lua
-- Minimal 2-Tab Floating Dashboard for the Competitive Programming Arena:
--   [1] Session Queue     — Staged problem queue, blind-mode masking, & quick actions
--   [2] Standing & Graph  — Global CF-equivalent rating, ASCII rating chart, & 8-domain breakdown
--
-- (Problem Statement, Constraints, Samples, and Unlocked Hints live exclusively
--  in the focused Problem Card overlay: <leader>mc or [c] from the Queue.)

local arena = require("competitive.arena")
local config = require("competitive.arena.config")

local M = {}

local state = {
	win = nil,
	buf = nil,
	win_width = 88,
	tab = "queue", -- "queue" | "stats"
	line_map = {}, -- 1-based buffer line -> problem id
	first_problem_row = nil,
	active_problem_row = nil,
	focused_pid = nil,
	cached_standing = nil,
}

function M.is_open()
	return state.win ~= nil and vim.api.nvim_win_is_valid(state.win)
end

function M.close()
	if state.win and vim.api.nvim_win_is_valid(state.win) then
		vim.api.nvim_win_close(state.win, true)
	end
	state.win = nil
	state.buf = nil
end

local function pad_right(str, width)
	local s = tostring(str or "")
	local len = vim.fn.strdisplaywidth(s)
	if len >= width then
		return vim.fn.strcharpart(s, 0, width)
	end
	return s .. string.rep(" ", width - len)
end

local function append_wrapped(lines, text, max_width, first_indent, next_indent, highlights, hl_group)
	first_indent = first_indent or "  "
	next_indent = next_indent or first_indent
	local raw_lines = vim.split(tostring(text or ""), "\n", { plain = true })
	for r_idx, raw in ipairs(raw_lines) do
		local indent = (r_idx == 1) and first_indent or next_indent
		local avail = math.max(20, max_width - vim.fn.strdisplaywidth(indent))
		if vim.fn.strdisplaywidth(raw) <= avail then
			table.insert(lines, indent .. raw)
			if highlights and hl_group then
				table.insert(highlights, { line = #lines - 1, group = hl_group })
			end
		else
			local words = vim.split(raw, "%s+", { trimempty = true })
			local cur = ""
			local cur_indent = indent
			for _, w in ipairs(words) do
				local candidate = (cur == "") and w or (cur .. " " .. w)
				if vim.fn.strdisplaywidth(candidate) > avail and cur ~= "" then
					table.insert(lines, cur_indent .. cur)
					if highlights and hl_group then
						table.insert(highlights, { line = #lines - 1, group = hl_group })
					end
					cur = w
					cur_indent = next_indent
					avail = math.max(20, max_width - vim.fn.strdisplaywidth(cur_indent))
				else
					cur = candidate
				end
			end
			if cur ~= "" then
				table.insert(lines, cur_indent .. cur)
				if highlights and hl_group then
					table.insert(highlights, { line = #lines - 1, group = hl_group })
				end
			end
		end
	end
end

local function append_action_footer(lines, highlights, rule_w)
	table.insert(lines, "  " .. string.rep("─", rule_w))
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
	table.insert(
		lines,
		"  [Enter/a] Accept & Edit   [c] Problem Card   [t] Test Samples   [h] Hint   [o] Open URL"
	)
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
	table.insert(
		lines,
		"  [v] Record Verdict / Submit   [1/2/Tab] Switch Tab   [x] End Session Early   [q] Hide"
	)
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
end

-- ── Tab 1: Session Queue Renderer ───────────────────────────────────────────

local function render_queue_tab(lines, highlights, inner_w, rule_w)
	if not arena.session or not arena.session.manifest then
		table.insert(lines, "  No active Teacher Arena session is currently staged.")
		table.insert(lines, "")
		table.insert(lines, "  When the Teacher invokes `arena_run` in pi, press <leader>ma (:Arena) here.")
		table.insert(lines, "  Press [2] or <Tab> to inspect your CF Standing, Trajectory Graph, and Domain Breakdown.")
		return
	end

	local manifest = arena.session.manifest
	local blind = manifest.blindMetadata == true
	local snap = arena.timer_snapshot(arena.session.active_problem_id)

	local clock_banner = ""
	local clock_hl = "ArenaTimerOk"
	if snap.mode == "stopwatch" then
		clock_banner = "Stopwatch: " .. arena.format_clock(snap.elapsed) .. " (Unrated Guided)"
	elseif snap.is_overtime then
		clock_banner = string.format(
			"OVERTIME: +%s (Budget %s)",
			arena.format_clock(snap.overtime),
			arena.format_clock(snap.budget)
		)
		clock_hl = "ArenaOvertime"
	else
		clock_banner = string.format(
			"Remaining: %s / %s (%s)",
			arena.format_clock(snap.remaining),
			arena.format_clock(snap.budget),
			snap.mode
		)
		if snap.remaining <= 180 then
			clock_hl = "ArenaTimerWarn"
		end
	end

	table.insert(
		lines,
		string.format(
			"  Session: %s   [%s · %s · %s]",
			manifest.title or "Arena",
			manifest.purpose or "guided",
			manifest.gradingPolicy or "practice",
			manifest.timerMode or "stopwatch"
		)
	)
	table.insert(highlights, { line = #lines - 1, group = "ArenaSubheader" })

	table.insert(
		lines,
		string.format(
			"  Standing: CF %d (%s)   |   %s",
			manifest.studentRating or 1200,
			manifest.studentTier or "Pupil",
			clock_banner
		)
	)
	table.insert(highlights, { line = #lines - 1, group = clock_hl })

	if manifest.coachNote and manifest.coachNote ~= "" then
		append_wrapped(lines, "Coach Note: " .. manifest.coachNote, inner_w, "  ", "    ")
	end

	table.insert(lines, "  " .. string.rep("─", rule_w))
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
	table.insert(
		lines,
		"   #  Status      Problem Title             File         Diff & Domain    Clock"
	)
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
	table.insert(lines, "  " .. string.rep("─", rule_w))
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })

	for idx, pid in ipairs(arena.session.order) do
		local ps = arena.session.problems[pid]
		local spec = ps.spec
		local is_act = (arena.session.active_problem_id == pid)
		local mark = is_act and "▶" or " "

		local status_str = "[STAGED]"
		local row_hl = nil
		if ps.state == "completed" and ps.verdict then
			local v_short = ps.verdict == "SUBMITTED" and "SUBMIT" or ps.verdict
			status_str = "[" .. v_short .. "]"
			row_hl = ps.verdict == "AC" and "ArenaVerdictAC"
				or (ps.verdict == "SUBMITTED" and "ArenaVerdictSubmit" or "ArenaVerdictWA")
		elseif is_act then
			status_str = "[▶ CODE]"
			row_hl = "ArenaTimerWarn"
		elseif ps.state == "accepted" then
			status_str = "[PAUSED]"
		end

		local meta_col = ""
		if blind and ps.state ~= "completed" then
			meta_col = "CF ???? · Blind"
		else
			local dom_short = vim.fn.strcharpart(spec.domain or "General", 0, 7)
			meta_col = string.format("CF %-4d · %s", spec.difficulty or 1200, dom_short)
		end

		local dur = arena.problem_elapsed_seconds(pid)
		local bud = tonumber(spec.timeBudgetSeconds) or 1500
		local clock_col = string.format("%s/%s", arena.format_clock(dur), arena.format_clock(bud))

		local row = string.format(
			"  %s%d. %s %s %s %s %s",
			mark,
			idx,
			pad_right(status_str, 11),
			pad_right(spec.title or pid, 25),
			pad_right(pid .. ".cpp", 12),
			pad_right(meta_col, 16),
			clock_col
		)
		table.insert(lines, row)
		local row_num = #lines
		state.line_map[row_num] = pid
		if not state.first_problem_row then
			state.first_problem_row = row_num
		end
		if is_act then
			state.active_problem_row = row_num
		end
		if row_hl then
			table.insert(highlights, { line = row_num - 1, group = row_hl })
		end

		if (ps.wrong_attempts or 0) > 0 or (ps.hints_used or 0) > 0 then
			table.insert(
				lines,
				string.format(
					"       └─ Wrong Attempts: %d   ·   Hints Used: %d/%d",
					ps.wrong_attempts or 0,
					ps.hints_used or 0,
					#(spec.hints or {})
				)
			)
			state.line_map[#lines] = pid
			table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
		end
	end

	append_action_footer(lines, highlights, rule_w)
end

-- ── Tab 2: Standing & Graph Renderer ────────────────────────────────────────

local function render_ascii_rating_chart(lines, highlights, st)
	local raw_traj = st.rating_trajectory
	local settled = {}
	if type(raw_traj) == "table" and #raw_traj > 0 then
		settled = raw_traj
	else
		for _, h in ipairs(st.recent_history or {}) do
			if h.rated and not h.pending_verdict and h.rating_after then
				table.insert(settled, h)
			end
		end
	end

	local limit = config.graph_history_limit or 100
	local start_idx = math.max(1, #settled - limit + 1)
	local vals = {}
	local first_before = 1200
	for i = start_idx, #settled do
		local item = settled[i]
		local ra = tonumber(item.rating_after)
		if ra then
			if #vals == 0 then
				first_before = tonumber(item.rating_before) or (ra - (tonumber(item.rating_delta) or 0))
			end
			table.insert(vals, ra)
		end
	end

	if #vals == 0 then
		table.insert(
			lines,
			"    (No rated problems settled yet — complete a drill or checkpoint to plot your trajectory)"
		)
		table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
		return
	end

	local max_cols = 32
	local num_cols = math.min(#vals, max_cols)
	local bmin, bmax, blast = {}, {}, {}

	if #vals <= max_cols then
		for i, v in ipairs(vals) do
			bmin[i], bmax[i], blast[i] = v, v, v
		end
	else
		for col = 1, num_cols do
			local s_i = math.floor((col - 1) * #vals / num_cols) + 1
			local e_i = math.floor(col * #vals / num_cols)
			local mn, mx, lst = vals[s_i], vals[s_i], vals[e_i]
			for j = s_i, e_i do
				if vals[j] < mn then
					mn = vals[j]
				end
				if vals[j] > mx then
					mx = vals[j]
				end
			end
			bmin[col], bmax[col], blast[col] = mn, mx, lst
		end
	end

	local data_min, data_max = bmin[1], bmax[1]
	for col = 1, num_cols do
		if bmin[col] < data_min then
			data_min = bmin[col]
		end
		if bmax[col] > data_max then
			data_max = bmax[col]
		end
	end

	local chart_h = 7
	local y_min, y_max
	if data_max == data_min then
		y_min = data_min - 30
		y_max = data_max + 30
	else
		local pad = math.max(12, math.floor((data_max - data_min) * 0.15))
		y_min = data_min - pad
		y_max = data_max + pad
	end

	local function val_to_row(v)
		local norm = (v - y_min) / (y_max - y_min)
		local r = chart_h - math.floor(norm * (chart_h - 1) + 0.5)
		return math.max(1, math.min(chart_h, r))
	end

	local grid_w = num_cols * 2 - 1
	local grid = {}
	for r = 1, chart_h do
		grid[r] = {}
		for x = 1, grid_w do
			grid[r][x] = " "
		end
	end

	for col = 1, num_cols do
		local x = (col - 1) * 2 + 1
		local r_top = val_to_row(bmax[col])
		local r_bot = val_to_row(bmin[col])
		local r_lst = val_to_row(blast[col])

		for r = r_top, r_bot do
			grid[r][x] = "│"
		end
		grid[r_lst][x] = "●"

		if col > 1 then
			local prev_r = val_to_row(blast[col - 1])
			local conn_x = x - 1
			if prev_r == r_lst then
				grid[r_lst][conn_x] = "─"
			elseif prev_r > r_lst then
				grid[prev_r][conn_x] = "╯"
				grid[r_lst][conn_x] = "╭"
				for r = r_lst + 1, prev_r - 1 do
					grid[r][conn_x] = "│"
				end
			else
				grid[prev_r][conn_x] = "╮"
				grid[r_lst][conn_x] = "╰"
				for r = prev_r + 1, r_lst - 1 do
					grid[r][conn_x] = "│"
				end
			end
		end
	end

	for r = 1, chart_h do
		local label_val = math.floor(y_max - ((r - 1) / (chart_h - 1)) * (y_max - y_min) + 0.5)
		table.insert(lines, string.format("    %4d ┤ %s", label_val, table.concat(grid[r], "")))
	end

	local axis_len = math.max(6, grid_w + 2)
	table.insert(lines, "         └" .. string.rep("─", axis_len))
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
	table.insert(
		lines,
		string.format(
			"           Last %d rated problem%s (Start: CF %d → Current: CF %d)",
			#vals,
			#vals == 1 and "" or "s",
			first_before,
			vals[#vals]
		)
	)
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
end

local function render_stats_tab(lines, highlights, rule_w)
	if not state.cached_standing then
		local standing, err = arena.fetch_standing_sync()
		if err then
			table.insert(lines, "  " .. err)
			return
		end
		state.cached_standing = standing
	end

	local st = state.cached_standing
	local g = st.global or {}

	table.insert(
		lines,
		string.format(
			"  Global Standing: CF %d  [%s]   (Peak: CF %d)",
			g.rating or 1200,
			g.tier or "Pupil",
			g.max_rating or 1200
		)
	)
	table.insert(highlights, { line = #lines - 1, group = "ArenaSubheader" })

	table.insert(
		lines,
		string.format(
			"  Rated Solved: %d / %d   |   Guided Solved: %d   |   Current Streak: %d",
			g.rated_solved or 0,
			g.rated_attempted or 0,
			g.unrated_solved or 0,
			g.streak or 0
		)
	)
	table.insert(lines, "  " .. string.rep("─", rule_w))
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })

	table.insert(lines, "  CF Rating Trajectory (Last " .. tostring(config.graph_history_limit or 100) .. " Rated):")
	table.insert(highlights, { line = #lines - 1, group = "ArenaSubheader" })
	render_ascii_rating_chart(lines, highlights, st)
	table.insert(lines, "  " .. string.rep("─", rule_w))
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })

	table.insert(
		lines,
		"  Curriculum Domain             Solved/Att   Avg Diff   Max Diff   Recent Misses"
	)
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })

	local domain_order = {
		{ key = "Dynamic Programming", label = "Dynamic Programming" },
		{ key = "Data Structures", label = "Data Structures" },
		{ key = "Math", label = "Math" },
		{ key = "Graphs", label = "Graphs" },
		{ key = "Strings", label = "Strings" },
		{ key = "Geometry", label = "Geometry" },
		{ key = "Implementation", label = "Implementation" },
		{ key = "Algorithmic Techniques (except DP)", label = "Algorithmic Techniques" },
	}
	local domains = st.domains or {}
	for _, item in ipairs(domain_order) do
		local d = domains[item.key]
			or { solved = 0, attempted = 0, avg_solved_difficulty = 0, max_solved_difficulty = 0, recent_failures = {} }
		local avg_s = (d.avg_solved_difficulty and d.avg_solved_difficulty > 0)
				and ("CF " .. tostring(d.avg_solved_difficulty))
			or "—"
		local max_s = (d.max_solved_difficulty and d.max_solved_difficulty > 0)
				and ("CF " .. tostring(d.max_solved_difficulty))
			or "—"
		local fails = (d.recent_failures and #d.recent_failures > 0) and table.concat(d.recent_failures, ", ") or "—"
		table.insert(
			lines,
			string.format(
				"  %s  %s  %s  %s  %s",
				pad_right(item.label, 28),
				pad_right(string.format("%d / %d", d.solved or 0, d.attempted or 0), 10),
				pad_right(avg_s, 8),
				pad_right(max_s, 8),
				vim.fn.strcharpart(fails, 0, 16)
			)
		)
	end

	table.insert(lines, "  " .. string.rep("─", rule_w))
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
	table.insert(lines, "  [1/2/Tab] Switch Tab   [r] Refresh Standing   [q] Hide")
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
end

-- ── Main Window Lifecycle ───────────────────────────────────────────────────

function M.render(preserve_cursor)
	if not M.is_open() then
		return
	end
	config.setup_highlights()

	local prev_cursor = nil
	if preserve_cursor then
		pcall(function()
			prev_cursor = vim.api.nvim_win_get_cursor(state.win)
		end)
	end

	state.line_map = {}
	state.first_problem_row = nil
	state.active_problem_row = nil

	local inner_w = math.max(72, (state.win_width or 88) - 4)
	local rule_w = math.max(68, (state.win_width or 88) - 6)

	local t1 = state.tab == "queue" and " [1] Session Queue ★ " or " [1] Session Queue "
	local t2 = state.tab == "stats" and " [2] Standing & Graph ★ " or " [2] Standing & Graph "

	local lines = {
		string.format("  COMPETITIVE PROGRAMMING ARENA          %s│%s", t1, t2),
		"  " .. string.rep("═", rule_w),
	}
	local highlights = {
		{ line = 0, group = "ArenaHeader" },
		{ line = 1, group = "ArenaMuted" },
	}

	if state.tab == "queue" then
		render_queue_tab(lines, highlights, inner_w, rule_w)
	else
		render_stats_tab(lines, highlights, rule_w)
	end

	vim.bo[state.buf].modifiable = true
	vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, lines)
	vim.bo[state.buf].modifiable = false

	local ns = vim.api.nvim_create_namespace("ArenaDashboard")
	vim.api.nvim_buf_clear_namespace(state.buf, ns, 0, -1)
	for _, h in ipairs(highlights) do
		pcall(vim.api.nvim_buf_add_highlight, state.buf, ns, h.group, h.line, 0, -1)
	end

	local total_lines = #lines
	if total_lines > 0 and M.is_open() then
		if preserve_cursor and prev_cursor then
			local target_r = math.max(1, math.min(total_lines, prev_cursor[1]))
			pcall(vim.api.nvim_win_set_cursor, state.win, { target_r, prev_cursor[2] })
		elseif state.tab == "queue" and (state.active_problem_row or state.first_problem_row) then
			local target_r = state.active_problem_row or state.first_problem_row
			pcall(vim.api.nvim_win_set_cursor, state.win, { target_r, 2 })
		else
			pcall(vim.api.nvim_win_set_cursor, state.win, { math.min(3, total_lines), 2 })
		end
	end
end

function M.refresh_if_open()
	if M.is_open() then
		M.render(true)
	end
end

local function get_target_problem_id()
	if M.is_open() and state.tab == "queue" then
		local ok, cur = pcall(vim.api.nvim_win_get_cursor, state.win)
		if ok and cur and state.line_map[cur[1]] then
			state.focused_pid = state.line_map[cur[1]]
			return state.focused_pid
		end
	end
	if not arena.session or not arena.session.order then
		return nil
	end
	if state.focused_pid and arena.session.problems[state.focused_pid] then
		return state.focused_pid
	end
	return arena.session.active_problem_id or arena.session.order[1]
end

local function bind_dashboard_keys(buf)
	local map = function(lhs, fn)
		vim.keymap.set("n", lhs, fn, { buffer = buf, nowait = true, silent = true })
	end

	map("q", M.close)
	map("<Esc>", M.close)

	map("1", function()
		state.tab = "queue"
		M.render(false)
	end)
	map("2", function()
		state.cached_standing = nil
		state.tab = "stats"
		M.render(false)
	end)
	map("<Tab>", function()
		if state.tab == "queue" then
			state.cached_standing = nil
			state.tab = "stats"
		else
			state.tab = "queue"
		end
		M.render(false)
	end)

	local accept_sel = function()
		local pid = get_target_problem_id()
		if pid then
			arena.accept_problem(pid)
		end
	end
	map("<CR>", accept_sel)
	map("a", accept_sel)

	map("c", function()
		local pid = get_target_problem_id()
		if pid and arena.session then
			local prev = arena.session.active_problem_id
			arena.session.active_problem_id = pid
			arena.show_problem_card()
			if not prev then
				arena.session.active_problem_id = prev
			end
		end
	end)
	map("t", function()
		local pid = get_target_problem_id()
		if pid and arena.session and not arena.session.active_problem_id then
			arena.session.active_problem_id = pid
		end
		M.close()
		arena.test_samples()
	end)
	map("h", function()
		local pid = get_target_problem_id()
		if pid and arena.session and not arena.session.active_problem_id then
			arena.session.active_problem_id = pid
		end
		M.close()
		arena.request_hint()
	end)
	map("v", function()
		local pid = get_target_problem_id()
		if pid and arena.session and not arena.session.active_problem_id then
			arena.session.active_problem_id = pid
		end
		M.close()
		arena.verdict_prompt()
	end)
	map("o", function()
		local pid = get_target_problem_id()
		if pid and arena.session and arena.session.problems[pid] then
			local url = arena.session.problems[pid].spec.url
			if url and url ~= "" then
				config.open_in_browser(url)
			else
				vim.notify("[Arena] No URL provided for " .. pid, vim.log.levels.WARN)
			end
		end
	end)
	map("x", function()
		M.close()
		arena.close_session()
	end)
	map("r", function()
		state.cached_standing = nil
		arena.load_manifest_if_needed()
		M.render(true)
	end)
end

function M.open(initial_tab)
	if initial_tab == "stats" or initial_tab == "queue" then
		state.tab = initial_tab
	end
	if state.tab == "stats" then
		state.cached_standing = nil
	end
	if M.is_open() then
		M.render(false)
		return
	end

	arena.load_manifest_if_needed()
	config.setup_highlights()

	local ew = vim.o.columns > 0 and vim.o.columns or 120
	local eh = vim.o.lines > 0 and vim.o.lines or 40
	local w = math.min(92, math.max(78, math.floor(ew * 0.78)))
	local h = math.min(28, math.max(20, math.floor(eh * 0.75)))
	state.win_width = w

	state.buf = vim.api.nvim_create_buf(false, true)
	vim.bo[state.buf].buftype = "nofile"
	vim.bo[state.buf].bufhidden = "wipe"
	vim.bo[state.buf].swapfile = false

	state.win = vim.api.nvim_open_win(state.buf, true, {
		relative = "editor",
		width = w,
		height = h,
		row = math.floor((eh - h) / 2),
		col = math.floor((ew - w) / 2),
		style = "minimal",
		border = "rounded",
		title = " Competitive Programming Arena (1/2/Tab switch · j/k move · q close) ",
		title_pos = "center",
	})
	vim.wo[state.win].cursorline = true
	vim.wo[state.win].wrap = false
	vim.wo[state.win].winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder"
	vim.wo[state.win].winblend = 0

	bind_dashboard_keys(state.buf)
	M.render(false)
end

function M.toggle()
	if M.is_open() then
		M.close()
	else
		M.open("queue")
	end
end

return M
