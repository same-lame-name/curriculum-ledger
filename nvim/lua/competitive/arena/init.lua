-- ~/.config/nvim/lua/competitive/arena/init.lua
-- Core Neovim runtime engine for the Competitive Programming Arena.
-- Layers cleanly on top of competitive/init.lua (<leader>cs) in ~/playground/contests/practice/.

local config = require("competitive.arena.config")

local M = {}

M.session = nil
local timer_handle = nil

-- ── Formatting & File Helpers ───────────────────────────────────────────────

function M.format_clock(seconds)
	local s = math.max(0, math.floor(tonumber(seconds) or 0))
	local m = math.floor(s / 60)
	local rem = s % 60
	return string.format("%02d:%02d", m, rem)
end

local function read_json(filepath)
	if not filepath or vim.fn.filereadable(filepath) ~= 1 then
		return nil
	end
	local ok, lines = pcall(vim.fn.readfile, filepath)
	if not ok or not lines or #lines == 0 then
		return nil
	end
	local raw = table.concat(lines, "\n")
	local dec_ok, data = pcall(vim.json.decode, raw)
	if not dec_ok then
		return nil
	end
	return data
end

local function write_json(filepath, payload)
	local dir = vim.fn.fnamemodify(filepath, ":h")
	vim.fn.mkdir(dir, "p")
	local encoded = vim.json.encode(payload)
	vim.fn.writefile({ encoded }, filepath)
end

function M.emit_event(payload)
	local paths = config.paths()
	if not paths or vim.fn.isdirectory(paths.active_dir) ~= 1 then
		return
	end
	payload.timestamp = os.time()
	local line = vim.json.encode(payload)
	pcall(vim.fn.writefile, { line }, paths.events_file, "a")
end

-- ── Two-Layer Guards ([D11]) ────────────────────────────────────────────────

function M.require_competitive_session()
	local comp_ok, comp = pcall(require, "competitive.init")
	if not comp_ok or not comp.is_active then
		vim.notify("[Competitive] Start a competitive session first (<leader>cs).", vim.log.levels.WARN)
		return false
	end
	return true
end

function M.has_staged_manifest()
	local paths = config.paths()
	return paths ~= nil and vim.fn.filereadable(paths.manifest_file) == 1
end

function M.load_manifest_if_needed()
	local paths = config.paths()
	if not paths or vim.fn.filereadable(paths.manifest_file) ~= 1 then
		return false
	end

	local manifest = read_json(paths.manifest_file)
	if not manifest or not manifest.problems then
		return false
	end

	if M.session and M.session.manifest and M.session.manifest.sessionId == manifest.sessionId then
		return true
	end

	-- Initialize fresh session state for this manifest
	local prob_states = {}
	local order = {}
	for idx, p in ipairs(manifest.problems) do
		table.insert(order, p.id)
		prob_states[p.id] = {
			index = idx,
			spec = p,
			state = "staged", -- "staged" | "accepted" | "completed"
			verdict = nil,
			started_at = nil,
			accumulated_seconds = 0,
			wrong_attempts = 0,
			hints_used = 0,
			hints_viewed = {},
			reflection = "",
			attempts = {},
			sample_results = nil,
			overtime_notified = false,
		}
	end

	M.session = {
		manifest = manifest,
		problems = prob_states,
		order = order,
		active_problem_id = nil,
		pooled_started_at = nil,
		pooled_accumulated_seconds = 0,
		pooled_overtime_notified = false,
	}

	M.emit_event({
		event = "session_opened",
		sessionId = manifest.sessionId,
	})
	M.start_background_timer()
	return true
end

function M.require_active_arena()
	if not M.require_competitive_session() then
		return false
	end
	if not M.load_manifest_if_needed() then
		vim.notify(
			"[Arena] No active Teacher session staged. Wait for the Teacher to launch arena_run in pi (or run :ArenaStats).",
			vim.log.levels.WARN
		)
		return false
	end
	return true
end

function M.require_active_problem()
	if not M.require_active_arena() then
		return false
	end
	if not M.session or not M.session.active_problem_id then
		local pfx = config.keymap_prefix or "<leader>m"
		vim.notify("[Arena] Accept a problem from the Arena queue first (" .. pfx .. "a).", vim.log.levels.WARN)
		return false
	end
	return true
end

-- ── Timer & Overtime Mechanics ([D5]) ───────────────────────────────────────

function M.problem_elapsed_seconds(prob_id)
	if not M.session or not M.session.problems[prob_id] then
		return 0
	end
	local ps = M.session.problems[prob_id]
	local total = ps.accumulated_seconds or 0
	if ps.started_at then
		total = total + math.max(0, os.time() - ps.started_at)
	end
	return total
end

function M.pooled_elapsed_seconds()
	if not M.session then
		return 0
	end
	local total = M.session.pooled_accumulated_seconds or 0
	if M.session.pooled_started_at then
		total = total + math.max(0, os.time() - M.session.pooled_started_at)
	end
	return total
end

function M.timer_snapshot(prob_id)
	if not M.session then
		return { mode = "stopwatch", elapsed = 0, budget = 0, remaining = 0, overtime = 0, is_overtime = false }
	end
	local manifest = M.session.manifest
	local mode = manifest.timerMode or "stopwatch"
	local pid = prob_id or M.session.active_problem_id

	if mode == "pooled" then
		local elapsed = M.pooled_elapsed_seconds()
		local budget = tonumber(manifest.totalTimeBudgetSeconds) or 1800
		local overtime = math.max(0, elapsed - budget)
		local remaining = math.max(0, budget - elapsed)
		return {
			mode = "pooled",
			elapsed = elapsed,
			budget = budget,
			remaining = remaining,
			overtime = overtime,
			is_overtime = elapsed > budget,
		}
	end

	local elapsed = pid and M.problem_elapsed_seconds(pid) or 0
	local ps = pid and M.session.problems[pid] or nil
	local budget = (ps and tonumber(ps.spec.timeBudgetSeconds)) or 1500

	if mode == "stopwatch" then
		return {
			mode = "stopwatch",
			elapsed = elapsed,
			budget = budget,
			remaining = 0,
			overtime = 0,
			is_overtime = false,
		}
	end

	local overtime = math.max(0, elapsed - budget)
	local remaining = math.max(0, budget - elapsed)
	return {
		mode = "per_problem",
		elapsed = elapsed,
		budget = budget,
		remaining = remaining,
		overtime = overtime,
		is_overtime = elapsed > budget,
	}
end

local function pause_active_clocks()
	if not M.session then
		return
	end
	local now = os.time()
	if M.session.active_problem_id then
		local ps = M.session.problems[M.session.active_problem_id]
		if ps and ps.started_at then
			ps.accumulated_seconds = (ps.accumulated_seconds or 0) + math.max(0, now - ps.started_at)
			ps.started_at = nil
		end
	end
	if M.session.pooled_started_at then
		M.session.pooled_accumulated_seconds = (M.session.pooled_accumulated_seconds or 0)
			+ math.max(0, now - M.session.pooled_started_at)
		M.session.pooled_started_at = nil
	end
end

function M.start_background_timer()
	if timer_handle then
		return
	end
	local uv = vim.uv or vim.loop
	timer_handle = uv.new_timer()
	timer_handle:start(
		1000,
		1000,
		vim.schedule_wrap(function()
			if not M.session then
				M.stop_background_timer()
				return
			end
			-- If active manifest was removed externally (e.g. /arena cancel), clean up
			if not M.has_staged_manifest() then
				M.session = nil
				M.stop_background_timer()
				return
			end

			local pid = M.session.active_problem_id
			if pid then
				local snap = M.timer_snapshot(pid)
				local ps = M.session.problems[pid]
				if snap.is_overtime and ps and not ps.overtime_notified then
					ps.overtime_notified = true
					vim.notify(
						string.format(
							"[Arena] Time budget (%s) reached for %s — now in OVERTIME. Finish your thought and submit when ready!",
							M.format_clock(snap.budget),
							ps.spec.title
						),
						vim.log.levels.WARN
					)
				end
			end

			require("competitive.arena.dashboard").refresh_if_open()
		end)
	)
end

function M.stop_background_timer()
	if timer_handle then
		pcall(function()
			timer_handle:stop()
			timer_handle:close()
		end)
		timer_handle = nil
	end
end

-- ── Code Snapshotting & Sample Population ([D2], [D7]) ─────────────────────

function M.problem_cpp_path(prob_id)
	return config.practice_dir .. prob_id .. ".cpp"
end

function M.snapshot_code(prob_id, suffix)
	vim.cmd("silent! update")
	local paths = config.paths()
	if not paths then
		return nil
	end
	local src = M.problem_cpp_path(prob_id)
	if vim.fn.filereadable(src) ~= 1 then
		return nil
	end
	vim.fn.mkdir(paths.scratch_dir, "p")
	local dst = string.format("%s/%s_%s.cpp", paths.scratch_dir, prob_id, suffix)
	local lines = vim.fn.readfile(src)
	vim.fn.writefile(lines, dst)
	return dst
end

-- Stages Sample 1 into input.txt without modifying or polluting the user's .cpp template.
local function stage_sample_one(prob_spec)
	vim.fn.mkdir(config.practice_dir, "p")
	local samples = prob_spec.samples or {}
	if #samples > 0 and samples[1].input then
		local input_path = config.practice_dir .. "input.txt"
		local in_lines = vim.split(vim.trim(samples[1].input), "\n", { plain = true })
		vim.fn.writefile(in_lines, input_path)
		-- Reload input.txt buffer if open in the competitive layout
		vim.cmd("silent! checktime")
	end
end

local function focus_main_code_window()
	-- In competitive/layout.lua, the main code pane is on the left (not input.txt / output.txt)
	for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
		local buf = vim.api.nvim_win_get_buf(win)
		local name = vim.api.nvim_buf_get_name(buf)
		if
			not string.match(name, "input%.txt$")
			and not string.match(name, "output%.txt$")
			and vim.api.nvim_win_get_config(win).relative == ""
		then
			vim.api.nvim_set_current_win(win)
			return
		end
	end
end

-- ── Core User Actions ───────────────────────────────────────────────────────

function M.accept_problem(prob_id)
	if not M.require_active_arena() then
		return
	end
	local ps = M.session.problems[prob_id]
	if not ps then
		vim.notify("[Arena] Unknown problem ID: " .. tostring(prob_id), vim.log.levels.ERROR)
		return
	end

	-- Pause any previously active problem timer
	pause_active_clocks()

	local now = os.time()
	if ps.state == "staged" then
		ps.state = "accepted"
	end
	if ps.state ~= "completed" then
		ps.started_at = now
		if not M.session.pooled_started_at then
			M.session.pooled_started_at = now
		end
	end
	M.session.active_problem_id = prob_id

	-- Close dashboard if open so we land directly in the code pane
	require("competitive.arena.dashboard").close()
	focus_main_code_window()

	vim.fn.mkdir(config.practice_dir, "p")
	vim.cmd("cd " .. vim.fn.fnameescape(config.practice_dir))
	local cpp_file = M.problem_cpp_path(prob_id)
	vim.cmd("edit " .. vim.fn.fnameescape(cpp_file))

	stage_sample_one(ps.spec)

	M.emit_event({
		event = "problem_accepted",
		problemId = prob_id,
		title = ps.spec.title,
	})

	local snap = M.timer_snapshot(prob_id)
	local clock_label = snap.mode == "stopwatch" and "Stopwatch 00:00"
		or ("Budget " .. M.format_clock(snap.budget))
	vim.notify(
		string.format("[Arena] %s (%s.cpp) — %s", ps.spec.title, prob_id, clock_label),
		vim.log.levels.INFO
	)
end

function M.open_or_toggle()
	if not M.require_competitive_session() then
		return
	end

	if not M.has_staged_manifest() then
		-- No active Teacher session staged; open read-only Standing & Graph view
		require("competitive.arena.dashboard").open("stats")
		return
	end

	M.load_manifest_if_needed()
	local manifest = M.session.manifest

	-- Guided Discovery Fast-Path ([D4]): if 1 problem in guided mode and still staged, auto-accept immediately!
	if manifest.purpose == "guided" and #M.session.order == 1 then
		local only_id = M.session.order[1]
		local ps = M.session.problems[only_id]
		if ps and ps.state == "staged" then
			M.accept_problem(only_id)
			return
		end
	end

	require("competitive.arena.dashboard").toggle()
end

-- ── Singleton Popup Helper for Cards, Sample Results, and Hint Ladder ──────
-- Ensures only ONE Arena popup float ever exists at a time:
--   - Reuses/resizes the active popup window in-place when unwrapping hints or switching views.
--   - Automatically closes on `q`, `<Esc>`, or `WinLeave` so a popup can never get orphaned on screen.

M.popup = {
	win = nil,
	buf = nil,
	kind = nil,
}

function M.close_popup()
	local win = M.popup.win
	M.popup.win = nil
	M.popup.buf = nil
	M.popup.kind = nil
	if win and vim.api.nvim_win_is_valid(win) then
		pcall(vim.api.nvim_win_close, win, true)
	end
end

local function wrap_popup_lines(lines, max_width)
	local out = {}
	for _, raw in ipairs(lines or {}) do
		local s = tostring(raw or "")
		if vim.fn.strdisplaywidth(s) <= max_width then
			table.insert(out, s)
		else
			local lead = string.match(s, "^(%s*)") or ""
			local cont_indent = lead .. "  "
			local words = vim.split(vim.trim(s), "%s+", { trimempty = true })
			local cur = ""
			local cur_indent = lead
			local avail = math.max(20, max_width - vim.fn.strdisplaywidth(cur_indent))
			for _, w in ipairs(words) do
				local cand = (cur == "") and w or (cur .. " " .. w)
				if vim.fn.strdisplaywidth(cand) > avail and cur ~= "" then
					table.insert(out, cur_indent .. cur)
					cur = w
					cur_indent = cont_indent
					avail = math.max(20, max_width - vim.fn.strdisplaywidth(cur_indent))
				else
					cur = cand
				end
			end
			if cur ~= "" then
				table.insert(out, cur_indent .. cur)
			end
		end
	end
	return out
end

function M.open_popup(title, lines, width_ratio, height_ratio, opts)
	opts = opts or {}
	config.setup_highlights()

	local ew = vim.o.columns > 0 and vim.o.columns or 120
	local eh = vim.o.lines > 0 and vim.o.lines or 40
	local w = math.max(58, math.min(ew - 6, math.floor(ew * (width_ratio or 0.70))))
	local wrapped_lines = wrap_popup_lines(lines, w - 4)
	local min_h = math.max(8, math.min(#wrapped_lines + 2, math.floor(eh * (height_ratio or 0.45))))
	local h = math.min(eh - 4, math.max(min_h, #wrapped_lines + 1))
	local row = math.max(1, math.floor((eh - h) / 2))
	local col = math.max(1, math.floor((ew - w) / 2))
	local win_title = " " .. title .. " (q / Esc close) "

	local reuse = M.popup.win
		and vim.api.nvim_win_is_valid(M.popup.win)
		and M.popup.buf
		and vim.api.nvim_buf_is_valid(M.popup.buf)

	local buf, win
	if reuse then
		buf = M.popup.buf
		win = M.popup.win
		pcall(vim.api.nvim_win_set_config, win, {
			relative = "editor",
			width = w,
			height = h,
			row = row,
			col = col,
			title = win_title,
			title_pos = "center",
		})
	else
		M.close_popup()
		buf = vim.api.nvim_create_buf(false, true)
		vim.bo[buf].buftype = "nofile"
		vim.bo[buf].bufhidden = "wipe"
		vim.bo[buf].swapfile = false

		win = vim.api.nvim_open_win(buf, true, {
			relative = "editor",
			width = w,
			height = h,
			row = row,
			col = col,
			style = "minimal",
			border = "rounded",
			title = win_title,
			title_pos = "center",
		})
		vim.wo[win].winblend = 0
		vim.wo[win].wrap = true
		vim.wo[win].cursorline = true
		vim.wo[win].winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder"

		vim.api.nvim_create_autocmd("WinLeave", {
			buffer = buf,
			once = true,
			callback = function()
				vim.schedule(function()
					if M.popup.win == win then
						M.close_popup()
					end
				end)
			end,
		})
	end

	M.popup.win = win
	M.popup.buf = buf
	M.popup.kind = opts.kind or "generic"

	vim.bo[buf].modifiable = true
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, wrapped_lines)
	vim.bo[buf].modifiable = false

	local ns = vim.api.nvim_create_namespace("ArenaPopupHighlights")
	vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
	for idx, l in ipairs(wrapped_lines) do
		local hl = nil
		if idx == 1 then
			hl = "ArenaSubheader"
		elseif string.find(l, "─", 1, true) then
			hl = "ArenaMuted"
		elseif string.find(l, "^%s*▾ Hint") or string.find(l, "^%s*✓ Sample") then
			hl = "ArenaVerdictAC"
		elseif string.find(l, "^%s*🔒 Hint") or string.find(l, "^%s*%[h / Enter%]") or string.find(l, "^%s*%(") then
			hl = "ArenaMuted"
		elseif string.find(l, "^%s*✗ Sample") then
			hl = "ArenaVerdictWA"
		end
		if hl then
			pcall(vim.api.nvim_buf_add_highlight, buf, ns, hl, idx - 1, 0, -1)
		end
	end

	if vim.api.nvim_get_current_win() ~= win then
		pcall(vim.api.nvim_set_current_win, win)
	end
	if opts.cursor_line then
		local target = math.max(1, math.min(#wrapped_lines, opts.cursor_line))
		pcall(vim.api.nvim_win_set_cursor, win, { target, 2 })
	end

	local key_opts = { buffer = buf, nowait = true, silent = true }
	vim.keymap.set("n", "q", M.close_popup, key_opts)
	vim.keymap.set("n", "<Esc>", M.close_popup, key_opts)

	if opts.keymaps then
		for lhs, fn in pairs(opts.keymaps) do
			vim.keymap.set("n", lhs, fn, key_opts)
		end
	end
end

-- ── Problem Card (<leader>mc) ───────────────────────────────────────────────

function M.show_problem_card()
	if not M.require_active_problem() then
		return
	end
	local pid = M.session.active_problem_id
	local ps = M.session.problems[pid]
	local spec = ps.spec
	local blind = M.session.manifest.blindMetadata == true
	local snap = M.timer_snapshot(pid)

	local clock_str = snap.mode == "stopwatch" and ("Elapsed: " .. M.format_clock(snap.elapsed))
		or (
			snap.is_overtime and ("OVERTIME: +" .. M.format_clock(snap.overtime))
			or ("Remaining: " .. M.format_clock(snap.remaining) .. " / " .. M.format_clock(snap.budget))
		)

	local meta_str = blind and "Difficulty & Domain: [BLIND CHECKPOINT MODE]"
		or string.format("Difficulty: CF %d  |  Domain: %s", spec.difficulty or 1200, spec.domain or "General")

	local lines = {
		string.format("  Problem:  %s  (%s.cpp)", spec.title, pid),
		string.format("  Platform: %s  |  %s", spec.platform or "Judge", clock_str),
		"  " .. meta_str,
		"  URL:      " .. (spec.url or ""),
		"  " .. string.rep("─", 64),
	}

	if spec.constraints and spec.constraints ~= "" then
		table.insert(lines, "  Constraints: " .. spec.constraints)
		table.insert(lines, "")
	end

	table.insert(lines, "  Statement:")
	for _, sl in ipairs(vim.split(spec.statementSummary or "", "\n", { plain = true })) do
		table.insert(lines, "    " .. sl)
	end

	local samples = spec.samples or {}
	if #samples > 0 then
		table.insert(lines, "")
		table.insert(lines, "  " .. string.rep("─", 64))
		for idx, smp in ipairs(samples) do
			table.insert(lines, string.format("  Sample %d Input:", idx))
			for _, il in ipairs(vim.split(vim.trim(smp.input or ""), "\n", { plain = true })) do
				table.insert(lines, "    " .. il)
			end
			table.insert(lines, string.format("  Sample %d Expected Output:", idx))
			for _, ol in ipairs(vim.split(vim.trim(smp.output or ""), "\n", { plain = true })) do
				table.insert(lines, "    " .. ol)
			end
			table.insert(lines, "")
		end
	end

	local total_hints = #(spec.hints or {})
	if total_hints > 0 then
		table.insert(lines, "  " .. string.rep("─", 64))
		table.insert(
			lines,
			string.format("  Socratic Hints (%d / %d unlocked — press h for Hint Ladder):", ps.hints_used, total_hints)
		)
		if ps.hints_used > 0 then
			for i = 1, math.min(ps.hints_used, total_hints) do
				table.insert(lines, string.format("    ▾ Hint %d: %s", i, spec.hints[i]))
			end
		end
	end

	table.insert(lines, "  " .. string.rep("─", 64))
	table.insert(lines, "  [h] Hint Ladder   [t] Test Samples   [o] Open URL   [v] Verdict / Submit   [q] Close")

	M.open_popup("Arena Problem Card — " .. spec.title, lines, 0.72, 0.65, {
		kind = "card",
		keymaps = {
			["h"] = function()
				M.request_hint(false)
			end,
			["t"] = function()
				M.close_popup()
				M.test_samples()
			end,
			["o"] = function()
				M.open_url()
			end,
			["v"] = function()
				M.close_popup()
				M.verdict_prompt()
			end,
		},
	})
end

-- ── Multi-Sample Automated Runner (<leader>mt — [D7]) ──────────────────────
-- Compiles ./bin/<id> without -D LOCAL (true online judge mode) and pipes each
-- sample input directly via stdin, checking pure stdout with OJ token/whitespace
-- tolerance (ignoring trailing spaces, trailing newlines, CRLF, and 1e-6 float drift).

local function normalize_output(str)
	local lines = vim.split(vim.trim(str or ""), "\n", { plain = true })
	local out = {}
	for _, l in ipairs(lines) do
		table.insert(out, (string.gsub(l, "%s+$", "")))
	end
	return table.concat(out, "\n")
end

local function oj_outputs_match(expected_raw, actual_raw)
	local exp_norm = normalize_output(expected_raw)
	local act_norm = normalize_output(actual_raw)
	if exp_norm == act_norm then
		return true
	end

	local exp_tokens = vim.split(exp_norm, "%s+", { trimempty = true })
	local act_tokens = vim.split(act_norm, "%s+", { trimempty = true })
	if #exp_tokens ~= #act_tokens then
		return false
	end

	for i = 1, #exp_tokens do
		local et = exp_tokens[i]
		local at = act_tokens[i]
		if et ~= at then
			if string.find(et, ".", 1, true) or string.find(at, ".", 1, true) then
				local en = tonumber(et)
				local an = tonumber(at)
				if not en or not an then
					return false
				end
				local diff = math.abs(en - an)
				local scale = math.max(1.0, math.abs(en))
				if (diff / scale) > 1e-6 then
					return false
				end
			else
				return false
			end
		end
	end
	return true
end

function M.test_samples()
	if not M.require_active_problem() then
		return
	end
	vim.cmd("silent! update")

	local pid = M.session.active_problem_id
	local ps = M.session.problems[pid]
	local spec = ps.spec
	local samples = spec.samples or {}

	if #samples == 0 then
		vim.notify("[Arena] No manifest samples attached — use <leader>ct with input.txt.", vim.log.levels.WARN)
		return
	end

	local cpp_path = M.problem_cpp_path(pid)
	local bin_dir = config.practice_dir .. "bin"
	vim.fn.mkdir(bin_dir, "p")
	local bin_path = bin_dir .. "/" .. pid

	vim.notify(string.format("[Arena] Compiling %s.cpp & testing %d sample(s)...", pid, #samples), vim.log.levels.INFO)
	local compile_cmd = string.format(
		"%s %s -o %s %s 2>&1",
		config.compiler or "g++",
		vim.fn.shellescape(cpp_path),
		vim.fn.shellescape(bin_path),
		config.compile_flags or "-std=c++17 -Wshadow -Wall -O2 -Wno-unused-result -Winvalid-pch"
	)
	local compile_out = vim.fn.system(compile_cmd)
	if vim.v.shell_error ~= 0 then
		local err_lines = { "Compilation Failed (" .. pid .. ".cpp):", string.rep("─", 64) }
		for _, l in ipairs(vim.split(compile_out, "\n", { plain = true })) do
			table.insert(err_lines, l)
		end
		M.open_popup("Arena Sample Runner — Compile Error", err_lines, 0.72, 0.55)
		return
	end

	local passed = 0
	local report_lines = {
		string.format("Sample Test Results for %s (%s.cpp)", spec.title, pid),
		string.rep("─", 64),
	}
	local details = {}

	local run_cmd = string.format("timeout 3s %s 2>/dev/null", vim.fn.shellescape(bin_path))
	for idx, smp in ipairs(samples) do
		local actual_raw = vim.fn.system(run_cmd, smp.input or "")
		local exit_code = vim.v.shell_error

		local expected_norm = normalize_output(smp.output or "")
		local actual_norm = normalize_output(actual_raw or "")
		local ok = (exit_code == 0) and oj_outputs_match(smp.output or "", actual_raw or "")

		if ok then
			passed = passed + 1
			table.insert(report_lines, string.format("✓ Sample %d: PASS", idx))
			table.insert(details, { sample = idx, passed = true })
		else
			local status_label = exit_code == 124 and "TLE (>3.0s)"
				or (exit_code ~= 0 and ("RE (exit " .. tostring(exit_code) .. ")") or "WA (Output Mismatch)")
			table.insert(report_lines, string.format("✗ Sample %d: FAIL — %s", idx, status_label))
			table.insert(report_lines, "  Input:")
			for _, l in ipairs(vim.split(vim.trim(smp.input or ""), "\n", { plain = true })) do
				table.insert(report_lines, "    " .. l)
			end
			table.insert(report_lines, "  Expected:")
			for _, l in ipairs(vim.split(expected_norm, "\n", { plain = true })) do
				table.insert(report_lines, "    " .. l)
			end
			table.insert(report_lines, "  Actual:")
			for _, l in ipairs(vim.split(actual_norm, "\n", { plain = true })) do
				table.insert(report_lines, "    " .. l)
			end
			table.insert(report_lines, "")
			table.insert(details, { sample = idx, passed = false, reason = status_label })
		end
	end

	table.insert(report_lines, 2, string.format("Summary: %d / %d samples passed", passed, #samples))
	ps.sample_results = { passed = passed, total = #samples, details = details }

	M.emit_event({
		event = "samples_tested",
		problemId = pid,
		passed = passed,
		total = #samples,
	})

	M.open_popup(string.format("Arena Samples (%d/%d Passed)", passed, #samples), report_lines, 0.68, 0.56)
end

-- ── Progressive In-Arena Hint Ladder (<leader>mh — [D6]) ───────────────────
-- Always available whenever the Teacher staged hints on the problem.
-- Single-window in-place unwrapping:
--   - First press of <leader>mh unlocks Hint 1 and opens the Hint Ladder window.
--   - Re-opening <leader>mh later shows your already-unlocked hints without burning the next hint.
--   - Inside the Hint Ladder window, pressing `h`, `<CR>`, or `<leader>mh` unwraps the next locked
--     hint rung IN-PLACE inside the exact same window (zero stacked windows).

local function unlock_next_hint_rung(pid, ps, hints)
	if ps.hints_used < #hints then
		ps.hints_used = ps.hints_used + 1
		ps.hints_viewed = {}
		for i = 1, ps.hints_used do
			table.insert(ps.hints_viewed, hints[i])
		end
		M.emit_event({
			event = "hint_used",
			problemId = pid,
			hintsUsed = ps.hints_used,
			totalHints = #hints,
		})
		return true
	end
	return false
end

function M.request_hint(unwrap_next)
	if not M.require_active_problem() then
		return
	end
	local manifest = M.session.manifest
	local pid = M.session.active_problem_id
	local ps = M.session.problems[pid]
	local hints = ps.spec.hints or {}

	if #hints == 0 then
		vim.notify("[Arena] No progressive hints staged for this problem.", vim.log.levels.INFO)
		return
	end

	local hint_popup_already_open = M.popup.win
		and vim.api.nvim_win_is_valid(M.popup.win)
		and M.popup.kind == "hint"

	-- Unlock Hint 1 automatically if 0 hints are unlocked so far,
	-- OR unlock the next rung when explicitly requested (e.g. pressing h / <CR> / <leader>mh while the hint window is open).
	if ps.hints_used == 0 or unwrap_next == true or hint_popup_already_open then
		unlock_next_hint_rung(pid, ps, hints)
	end

	local is_unrated = (manifest.purpose == "guided" or manifest.gradingPolicy == "practice")
	local lines = {
		string.format("  Socratic Hint Ladder — %s (%s.cpp)  [%d / %d unlocked]", ps.spec.title, pid, ps.hints_used, #hints),
		is_unrated and "  (Unrated guided session — hints carry no rating penalty)"
			or "  (Rated session — Hint 1 caps Elo score S at 0.25; Hint 2+ caps S at 0.10)",
		"  " .. string.rep("─", 62),
	}

	for i = 1, #hints do
		if i <= ps.hints_used then
			table.insert(lines, string.format("  ▾ Hint %d / %d  [UNLOCKED]", i, #hints))
			for _, hl in ipairs(vim.split(hints[i], "\n", { plain = true })) do
				table.insert(lines, "    " .. hl)
			end
			table.insert(lines, "")
		else
			local prompt_str = (i == ps.hints_used + 1)
				and "  [LOCKED — press h or Enter to unwrap]"
				or "  [LOCKED]"
			table.insert(lines, string.format("  🔒 Hint %d / %d%s", i, #hints, prompt_str))
		end
	end

	table.insert(lines, "  " .. string.rep("─", 62))
	if ps.hints_used < #hints then
		table.insert(
			lines,
			string.format(
				"  [h / Enter] Unwrap Hint %d/%d   [c] Problem Card   [q / Esc] Close",
				ps.hints_used + 1,
				#hints
			)
		)
	else
		table.insert(lines, "  (All hints unwrapped)   [c] Problem Card   [q / Esc] Close")
	end

	M.open_popup(
		string.format("Arena Hint Ladder (%d/%d)", ps.hints_used, #hints),
		lines,
		0.66,
		0.45,
		{
			kind = "hint",
			keymaps = {
				["h"] = function()
					if ps.hints_used < #hints then
						M.request_hint(true)
					else
						vim.notify("[Arena] All hints are already unwrapped.", vim.log.levels.INFO)
					end
				end,
				["<CR>"] = function()
					if ps.hints_used < #hints then
						M.request_hint(true)
					end
				end,
				["c"] = function()
					M.show_problem_card()
				end,
			},
		}
	)
end

-- ── Browser URL Opener (<leader>mo) ─────────────────────────────────────────

function M.open_url()
	if not M.require_active_problem() then
		return
	end
	local pid = M.session.active_problem_id
	local ps = M.session.problems[pid]
	local url = ps and ps.spec and ps.spec.url
	config.open_in_browser(url)
end

-- ── Unified Verdict & Submission Menu (<leader>mv — [D8]) ───────────────────

local function all_problems_completed()
	if not M.session then
		return false
	end
	for _, pid in ipairs(M.session.order) do
		local ps = M.session.problems[pid]
		if not ps or ps.state ~= "completed" then
			return false
		end
	end
	return true
end

local function finalize_problem_verdict(pid, verdict, ask_reflection)
	local ps = M.session.problems[pid]
	if not ps then
		return
	end

	pause_active_clocks()
	M.snapshot_code(pid, "final")

	local finish_after_note = function(note)
		ps.reflection = vim.trim(note or "")
		ps.verdict = verdict
		ps.state = "completed"
		local elapsed = M.problem_elapsed_seconds(pid)
		table.insert(ps.attempts, {
			attempt = ps.wrong_attempts + (verdict == "AC" and 1 or 0),
			verdict = verdict,
			elapsedSeconds = elapsed,
		})

		M.emit_event({
			event = "problem_verdict",
			problemId = pid,
			verdict = verdict,
			durationSeconds = elapsed,
			wrongAttempts = ps.wrong_attempts,
			hintsUsed = ps.hints_used,
		})

		if all_problems_completed() then
			M.write_result_and_close("completed")
		else
			M.session.active_problem_id = nil
			vim.notify(
				string.format("[Arena] Logged %s for %s. Pick the next problem from the Queue.", verdict, ps.spec.title),
				vim.log.levels.INFO
			)
			require("competitive.arena.dashboard").open("queue")
		end
	end

	if ask_reflection then
		vim.ui.input({
			prompt = string.format("[Arena %s — %s] Reflection / complexity note (Enter to skip): ", verdict, pid),
		}, function(input)
			finish_after_note(input or "")
		end)
	else
		finish_after_note("")
	end
end

-- Compact 6-option Floating Verdict & Submit Menu (<leader>mv / [v]).
-- Navigable with native Vim j/k + <CR> OR single-key hotkeys (a, s, w, t, r, x).
function M.verdict_prompt()
	if not M.require_active_problem() then
		return
	end
	M.close_popup()
	config.setup_highlights()

	local pid = M.session.active_problem_id
	local ps = M.session.problems[pid]
	local elapsed_str = M.format_clock(M.problem_elapsed_seconds(pid))

	local items = {
		{ key = "a", code = "AC", keep = false, icon = "✅", short = "AC", desc = "Accepted on Online Judge", hl = "ArenaVerdictAC" },
		{ key = "s", code = "SUBMITTED", keep = false, icon = "📤", short = "Hand to Teacher", desc = "Submit code without OJ verdict", hl = "ArenaVerdictSubmit" },
		{ key = "w", code = "WA", keep = true, icon = "❌", short = "WA  (retry)", desc = "Snapshot attempt & keep coding", hl = "ArenaTimerWarn" },
		{ key = "t", code = "TLE", keep = true, icon = "⏱ ", short = "TLE (retry)", desc = "Snapshot attempt & keep coding", hl = "ArenaTimerWarn" },
		{ key = "r", code = "RE", keep = true, icon = "💥", short = "RE  (retry)", desc = "Snapshot attempt & keep coding", hl = "ArenaTimerWarn" },
		{ key = "x", code = "ABANDON", keep = false, icon = "🏳️ ", short = "Give Up / Stuck", desc = "Stop & return code to Teacher", hl = "ArenaVerdictWA" },
	}

	local lines = {
		string.format("  %s (%s.cpp)  ·  Elapsed %s  ·  WA: %d", ps.spec.title, pid, elapsed_str, ps.wrong_attempts or 0),
		"  " .. string.rep("─", 54),
	}
	local row_to_item = {}
	local hls = {
		{ line = 0, group = "ArenaSubheader" },
		{ line = 1, group = "ArenaMuted" },
	}

	local first_item_row = #lines + 1
	for _, it in ipairs(items) do
		local line_str = string.format("   [%s]  %s %-16s  %s", it.key, it.icon, it.short, it.desc)
		table.insert(lines, line_str)
		row_to_item[#lines] = it
		table.insert(hls, { line = #lines - 1, group = it.hl })
	end

	table.insert(lines, "  " .. string.rep("─", 54))
	table.insert(hls, { line = #lines - 1, group = "ArenaMuted" })
	table.insert(lines, "   [j/k + CR] select   [a/s/w/t/r/x] hotkey   [q] cancel")
	table.insert(hls, { line = #lines - 1, group = "ArenaMuted" })

	local buf = vim.api.nvim_create_buf(false, true)
	vim.bo[buf].buftype = "nofile"
	vim.bo[buf].bufhidden = "wipe"
	vim.bo[buf].swapfile = false
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	vim.bo[buf].modifiable = false

	local ns = vim.api.nvim_create_namespace("ArenaVerdictMenu")
	for _, h in ipairs(hls) do
		pcall(vim.api.nvim_buf_add_highlight, buf, ns, h.group, h.line, 0, -1)
	end

	local w = 60
	local h = #lines
	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		width = w,
		height = h,
		row = math.floor((vim.o.lines - h) / 2),
		col = math.floor((vim.o.columns - w) / 2),
		style = "minimal",
		border = "rounded",
		title = " Record Verdict / Submit ",
		title_pos = "center",
	})
	vim.wo[win].winblend = 0
	vim.wo[win].wrap = false
	vim.wo[win].cursorline = true
	vim.wo[win].winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder"
	pcall(vim.api.nvim_win_set_cursor, win, { first_item_row, 2 })

	local close_menu = function()
		if vim.api.nvim_win_is_valid(win) then
			pcall(vim.api.nvim_win_close, win, true)
		end
	end

	vim.api.nvim_create_autocmd("WinLeave", {
		buffer = buf,
		once = true,
		callback = function()
			vim.schedule(close_menu)
		end,
	})

	local apply_choice = function(choice)
		if not choice then
			return
		end
		close_menu()

		if choice.keep then
			ps.wrong_attempts = ps.wrong_attempts + 1
			local elapsed = M.problem_elapsed_seconds(pid)
			local tag = string.format("attempt_%d_%s", ps.wrong_attempts, choice.code)
			M.snapshot_code(pid, tag)
			table.insert(ps.attempts, {
				attempt = ps.wrong_attempts,
				verdict = choice.code,
				elapsedSeconds = elapsed,
			})
			M.emit_event({
				event = "attempt_logged",
				problemId = pid,
				verdict = choice.code,
				wrongAttempts = ps.wrong_attempts,
				elapsedSeconds = elapsed,
			})
			vim.notify(
				string.format("[Arena] Logged %s (#%d) for %s.cpp — clock running.", choice.code, ps.wrong_attempts, pid),
				vim.log.levels.WARN
			)
			return
		end

		finalize_problem_verdict(pid, choice.code, true)
	end

	local opts = { buffer = buf, nowait = true, silent = true }
	vim.keymap.set("n", "q", close_menu, opts)
	vim.keymap.set("n", "<Esc>", close_menu, opts)
	vim.keymap.set("n", "<CR>", function()
		if not vim.api.nvim_win_is_valid(win) then
			return
		end
		local r = vim.api.nvim_win_get_cursor(win)[1]
		apply_choice(row_to_item[r])
	end, opts)

	for _, it in ipairs(items) do
		vim.keymap.set("n", it.key, function()
			apply_choice(it)
		end, opts)
	end
end

-- ── Closing Session & Returning Packet to Teacher (<leader>mx) ──────────────

function M.write_result_and_close(status)
	if not M.session then
		return
	end
	pause_active_clocks()
	local paths = config.paths()
	if not paths then
		return
	end

	local problems_out = {}
	for _, pid in ipairs(M.session.order) do
		local ps = M.session.problems[pid]
		local dur = M.problem_elapsed_seconds(pid)
		local snap = M.timer_snapshot(pid)

		-- If a problem was accepted and coded on, but no final verdict was picked before closing,
		-- snapshot its current code and default to SUBMITTED so the Teacher still receives the C++ code!
		local verdict = ps.verdict
		if not verdict then
			if ps.state == "accepted" then
				M.snapshot_code(pid, "final")
				verdict = "SUBMITTED"
			else
				verdict = "SKIPPED"
			end
		end

		table.insert(problems_out, {
			id = pid,
			catalogId = ps.spec.catalogId or pid,
			title = ps.spec.title,
			verdict = verdict,
			durationSeconds = dur,
			budgetSeconds = ps.spec.timeBudgetSeconds or snap.budget,
			overtimeSeconds = snap.mode ~= "stopwatch" and math.max(0, dur - (ps.spec.timeBudgetSeconds or snap.budget))
				or 0,
			wrongAttempts = ps.wrong_attempts,
			attempts = ps.attempts,
			hintsUsed = ps.hints_used,
			hintsViewed = ps.hints_viewed,
			reflection = ps.reflection,
		})
	end

	local result_payload = {
		sessionId = M.session.manifest.sessionId,
		status = status or "completed",
		pooledElapsedSeconds = M.pooled_elapsed_seconds(),
		completedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
		problems = problems_out,
	}

	write_json(paths.result_file, result_payload)
	M.emit_event({
		event = "session_closed",
		sessionId = M.session.manifest.sessionId,
	})

	M.stop_background_timer()
	M.close_popup()
	require("competitive.arena.dashboard").close()
	M.session = nil

	vim.notify("[Arena] Session completed and returned to the Teacher in pi!", vim.log.levels.INFO)
end

function M.close_session()
	if not M.require_active_arena() then
		return
	end

	local unresolved = {}
	for _, pid in ipairs(M.session.order) do
		local ps = M.session.problems[pid]
		if ps.state ~= "completed" then
			table.insert(unresolved, ps.spec.title .. " (" .. pid .. ")")
		end
	end

	if #unresolved == 0 then
		M.write_result_and_close("completed")
		return
	end

	local choice = vim.fn.confirm(
		string.format("Close Arena & submit current code to Teacher? (%d unresolved: %s)", #unresolved, table.concat(unresolved, ", ")),
		"&Yes\n&Cancel",
		1
	)
	if choice == 1 then
		M.write_result_and_close("completed")
	end
end

-- ── Python Helper for Standing & Graph Tab ──────────────────────────────────

function M.fetch_standing_sync()
	local paths = config.paths()
	if not paths or vim.fn.filereadable(paths.script_path) ~= 1 then
		return nil, "Arena ledger not found (launch pi first so ~/.pi-arena-root is initialized)"
	end
	local cmd = string.format("%s %s standing 2>/dev/null", config.python_cmd, vim.fn.shellescape(paths.script_path))
	local out = vim.fn.system(cmd)
	if vim.v.shell_error ~= 0 or not out or out == "" then
		return nil, "Failed to query arena.py standing"
	end
	local ok, decoded = pcall(vim.json.decode, out)
	if not ok then
		return nil, "Failed to decode arena.py standing JSON"
	end
	return decoded, nil
end

return M
