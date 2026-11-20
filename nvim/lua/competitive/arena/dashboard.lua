-- ~/.config/nvim/lua/competitive/arena/dashboard.lua
-- Minimal 2-Tab Floating Dashboard for the Competitive Programming Arena:
--   [1] Queue             — Staged problem queue, blind-mode masking, & quick actions
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
	graph_zoom = "recent", -- "recent" (last 30) | "full" (last 100)
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

	local actions = {
		"[Enter/a] Accept",
		"[c] Card",
		"[t] Samples",
		"[J] Judge",
		"[p] Approach",
		"[h] Hint",
		"[v] Verdict",
		"[o] URL",
		"[1/2/Tab] Switch Tab",
		"[x] End Early",
		"[q] Hide",
	}

	local cur = "  "
	for _, act in ipairs(actions) do
		local cand = (cur == "  ") and ("  " .. act) or (cur .. "  " .. act)
		if vim.fn.strdisplaywidth(cand) > rule_w and cur ~= "  " then
			table.insert(lines, cur)
			table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
			cur = "  " .. act
		else
			cur = cand
		end
	end
	if cur ~= "  " then
		table.insert(lines, cur)
		table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
	end
end

-- ── Tab 1: Queue Renderer ───────────────────────────────────────────────────

local function render_queue_tab(lines, highlights, inner_w, rule_w)
	if not arena.session or not arena.session.manifest then
		table.insert(lines, "  No active session staged (Teacher or ThemeCP).")
		table.insert(lines, "")
		table.insert(lines, "  " .. string.rep("─", rule_w))
		table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
		table.insert(lines, "  [1/2/Tab] Switch Tab   [r] Refresh   [q] Hide")
		table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })
		return
	end

	local manifest = arena.session.manifest
	local blind = manifest.blindMetadata == true
	local snap = arena.timer_snapshot(arena.session.active_problem_id)

	local clock_banner = ""
	local clock_hl = "ArenaTimerOk"
	if snap.mode == "stopwatch" then
		clock_banner = arena.format_clock(snap.elapsed) .. " (Stopwatch)"
	elseif snap.is_overtime then
		clock_banner = string.format(
			"+%s OVERTIME (Budget %s)",
			arena.format_clock(snap.overtime),
			arena.format_clock(snap.budget)
		)
		clock_hl = "ArenaOvertime"
	else
		clock_banner = string.format(
			"%s Remaining (Budget %s)",
			arena.format_clock(snap.remaining),
			arena.format_clock(snap.budget)
		)
		if snap.remaining <= 180 then
			clock_hl = "ArenaTimerWarn"
		end
	end

	table.insert(
		lines,
		string.format(
			"  ⏱  %-32s   [%s · %s]",
			clock_banner,
			manifest.purpose or "guided",
			manifest.timerMode or "stopwatch"
		)
	)
	table.insert(highlights, { line = #lines - 1, group = clock_hl })

	local ctx_label = manifest.title or "Session"
	table.insert(
		lines,
		string.format(
			"  Standing: CF %d (%s)   │   %s",
			manifest.studentRating or 1200,
			manifest.studentTier or "Pupil",
			ctx_label
		)
	)
	table.insert(highlights, { line = #lines - 1, group = "ArenaSubheader" })

	if manifest.coachNote and manifest.coachNote ~= "" then
		append_wrapped(lines, "Coach Note: " .. manifest.coachNote, inner_w, "  ", "    ", highlights, "ArenaMuted")
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

	local has_incomplete_before = false
	for idx, pid in ipairs(arena.session.order) do
		local ps = arena.session.problems[pid]
		local spec = ps.spec
		local is_act = (arena.session.active_problem_id == pid)
		local mark = is_act and "▶" or " "

		local is_locked = manifest.strictOrder == true and has_incomplete_before and (ps.state ~= "completed")
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
		elseif is_locked then
			status_str = "[LOCKED]"
			row_hl = "ArenaMuted"
		end

		if ps.state ~= "completed" then
			has_incomplete_before = true
		end

		local meta_col = ""
		if blind and ps.state ~= "completed" then
			meta_col = "CF ???? · Blind"
		else
			-- Guided runs may carry no difficulty or domain; JSON null would arrive as vim.NIL.
			local dom_short = vim.fn.strcharpart(type(spec.domain) == "string" and spec.domain or "—", 0, 7)
			local diff_num = tonumber(spec.difficulty)
			meta_col = diff_num and string.format("CF %-4d · %s", diff_num, dom_short) or ("CF —    · " .. dom_short)
		end

		local dur = arena.problem_elapsed_seconds(pid)
		local clock_col
		if (manifest.timerMode or "stopwatch") == "stopwatch" then
			clock_col = arena.format_clock(dur)
		else
			local bud = tonumber(spec.timeBudgetSeconds) or 1500
			clock_col = string.format("%s/%s", arena.format_clock(dur), arena.format_clock(bud))
		end

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

local function render_ascii_rating_chart(lines, highlights, st, rule_w)
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

	local is_recent = (state.graph_zoom ~= "full")
	local limit = is_recent and 45 or (config.graph_history_limit or 150)
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

	-- Responsive canvas: spans full rule_w width
	local chart_w = math.max(30, (rule_w or 80) - 11)
	local chart_h = 7
	local w_dots = chart_w * 2
	local h_dots = chart_h * 4

	local data_min, data_max = vals[1], vals[1]
	for _, v in ipairs(vals) do
		if v < data_min then data_min = v end
		if v > data_max then data_max = v end
	end

	local y_min, y_max
	if data_max == data_min then
		y_min = data_min - 30
		y_max = data_max + 30
	else
		local pad = math.max(6, math.floor((data_max - data_min) * 0.08))
		y_min = data_min - pad
		y_max = data_max + pad
	end

	local grid = {}
	for r = 1, chart_h do
		grid[r] = {}
		for c = 1, chart_w do
			grid[r][c] = 0
		end
	end

	local mask = {
		{ 0x01, 0x08 },
		{ 0x02, 0x10 },
		{ 0x04, 0x20 },
		{ 0x40, 0x80 },
	}

	local function set_dot(x, y)
		if x < 0 or x >= w_dots or y < 0 or y >= h_dots then return end
		local cr = math.floor(y / 4) + 1
		local cc = math.floor(x / 2) + 1
		local dr = (y % 4) + 1
		local dc = (x % 2) + 1
		grid[cr][cc] = bit.bor(grid[cr][cc], mask[dr][dc])
	end

	local function val_to_y(v)
		local norm = (v - y_min) / (y_max - y_min)
		local y = math.floor((h_dots - 1) - norm * (h_dots - 1) + 0.5)
		return math.max(0, math.min(h_dots - 1, y))
	end

	local function draw_line(x0, y0, x1, y1)
		local dx = math.abs(x1 - x0)
		local dy = math.abs(y1 - y0)
		local sx = x0 < x1 and 1 or -1
		local sy = y0 < y1 and 1 or -1
		local err = dx - dy
		local cx, cy = x0, y0
		while true do
			set_dot(cx, cy)
			if cx == x1 and cy == y1 then break end
			local e2 = 2 * err
			if e2 > -dy then
				err = err - dy
				cx = cx + sx
			end
			if e2 < dx then
				err = err + dx
				cy = cy + sy
			end
		end
	end

	local n = #vals
	if n <= w_dots then
		local prev_x, prev_y = nil, nil
		for i, v in ipairs(vals) do
			local x = (n == 1) and 0 or math.floor((i - 1) * (w_dots - 1) / (n - 1) + 0.5)
			local y = val_to_y(v)
			if prev_x ~= nil then
				draw_line(prev_x, prev_y, x, y)
			else
				set_dot(x, y)
			end
			prev_x, prev_y = x, y
		end
	else
		-- Bucketing across w_dots when total points exceed horizontal dot resolution
		local prev_y = nil
		for x = 0, w_dots - 1 do
			local s_idx = math.floor(x * n / w_dots) + 1
			local e_idx = math.floor((x + 1) * n / w_dots)
			local mn, mx, last = vals[s_idx], vals[s_idx], vals[e_idx]
			for j = s_idx, e_idx do
				if vals[j] < mn then mn = vals[j] end
				if vals[j] > mx then mx = vals[j] end
			end
			local y_top = val_to_y(mx)
			local y_bot = val_to_y(mn)
			local y_last = val_to_y(last)
			for y = y_top, y_bot do set_dot(x, y) end
			if prev_y ~= nil then
				local y_conn_top = math.min(prev_y, y_last)
				local y_conn_bot = math.max(prev_y, y_last)
				for y = y_conn_top, y_conn_bot do set_dot(x, y) end
			end
			prev_y = y_last
		end
	end

	for r = 1, chart_h do
		local row_chars = {}
		for c = 1, chart_w do
			local b = grid[r][c]
			table.insert(row_chars, b > 0 and vim.fn.nr2char(0x2800 + b) or " ")
		end
		local prefix = (r == 1) and string.format("  %4d ┐ ", data_max)
			or ((r == chart_h) and string.format("  %4d ┘ ", data_min) or "       │ ")
		table.insert(lines, prefix .. table.concat(row_chars, ""))
	end

	local axis_len = chart_w + 2
	table.insert(lines, "       └" .. string.rep("─", axis_len))
	table.insert(highlights, { line = #lines - 1, group = "ArenaMuted" })

	local cur_val = vals[#vals]
	local net_delta = cur_val - first_before
	local sign = net_delta >= 0 and "+" or ""
	local scope_word = is_recent and "Recent" or "All"
	local peak_tag = (cur_val >= data_max) and " ★ Peak" or ""
	table.insert(
		lines,
		string.format(
			"         %s %d rated problem%s (Start: CF %d → Current: CF %d%s  │  Net: %s%d)",
			scope_word,
			#vals,
			#vals == 1 and "" or "s",
			first_before,
			cur_val,
			peak_tag,
			sign,
			net_delta
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

	local settled_count = (type(st.rating_trajectory) == "table" and #st.rating_trajectory > 0)
		and #st.rating_trajectory
		or #(st.recent_history or {})
	local is_recent = (state.graph_zoom ~= "full")
	local zoom_toggle_label = is_recent and "[z] Zoom: Full Journey" or "[z] Zoom: Recent (45)"
	local scope_title = is_recent and "  CF Rating Trajectory (Recent 45 Rated):"
		or string.format("  CF Rating Trajectory (Full Journey — %d Rated):", settled_count)

	table.insert(lines, scope_title)
	table.insert(highlights, { line = #lines - 1, group = "ArenaSubheader" })
	render_ascii_rating_chart(lines, highlights, st, rule_w)
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
	table.insert(
		lines,
		string.format("  [1/2/Tab] Switch Tab   %s   [r] Refresh Standing   [q] Hide", zoom_toggle_label)
	)
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

	local t1 = state.tab == "queue" and " [1] Queue ★ " or " [1] Queue "
	local t2 = state.tab == "stats" and " [2] Standing & Graph ★ " or " [2] Standing & Graph "
	local tab_str = string.format("%s│%s", t1, t2)
	local spaces = math.max(2, rule_w - vim.fn.strdisplaywidth("  ARENA") - vim.fn.strdisplaywidth(tab_str))
	local header_line = "  ARENA" .. string.rep(" ", spaces) .. tab_str

	local lines = {
		header_line,
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
	map("J", function()
		local pid = get_target_problem_id()
		if pid and arena.session and not arena.session.active_problem_id then
			arena.session.active_problem_id = pid
		end
		M.close()
		arena.judge_hidden()
	end)
	map("p", function()
		local pid = get_target_problem_id()
		if pid and arena.session and not arena.session.active_problem_id then
			arena.session.active_problem_id = pid
		end
		M.close()
		arena.prompt_approach()
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
	map("z", function()
		if state.tab == "stats" then
			state.graph_zoom = (state.graph_zoom == "recent") and "full" or "recent"
			M.render(true)
		end
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
	local h = math.min(30, math.max(22, math.floor(eh * 0.80)))
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
		title = " ARENA (1/2/Tab: Switch Tab · j/k: Move · q: Close) ",
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
