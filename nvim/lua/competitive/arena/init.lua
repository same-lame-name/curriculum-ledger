-- ~/.config/nvim/lua/competitive/arena/init.lua
-- Core Neovim runtime engine for the Competitive Programming Arena.
-- Layers cleanly on top of competitive/init.lua (<leader>cs) in ~/playground/contests/practice/.

local config = require("competitive.arena.config")
local timer_mod = require("competitive.arena.timer")
local popup_mod = require("competitive.arena.popup")
local runner_mod = require("competitive.arena.runner")
local verdicts_mod = require("competitive.arena.verdicts")

local M = {}

M.session = nil

-- ── JSON & Event Log Helpers ───────────────────────────────────────────────

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

function M.write_json(filepath, payload)
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
		M.start_background_timer()
		return true
	end

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
			approach = "",
			approach_asked = false,
			thinking_seconds = nil,
			edit_hook_armed = false,
			local_judge = nil,
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
			"[Arena] No active session staged (launch via Teacher or ThemeCP in pi).",
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

-- ── Approach Line (written before coding, in rated sessions) ───────────────

local function mark_thinking_cutoff(prob_id)
	if not M.session or not M.session.problems then
		return
	end
	local ps = M.session.problems[prob_id]
	if not ps or ps.thinking_seconds ~= nil then
		return
	end
	ps.thinking_seconds = M.problem_elapsed_seconds(prob_id)
end

function M.approach_mode()
	local mode = M.session and M.session.manifest and M.session.manifest.approachNote
	if type(mode) ~= "string" then
		return "off"
	end
	return mode
end

function M.prompt_approach(on_done)
	if not M.require_active_problem() then
		return
	end
	local pid = M.session.active_problem_id
	local ps = M.session.problems[pid]
	ps.approach_asked = true
	vim.ui.input({
		prompt = string.format("[Arena %s] Approach in one line (Enter/Esc to skip): ", pid),
		default = ps.approach or "",
	}, function(input)
		local text = vim.trim(input or "")
		if text ~= "" then
			mark_thinking_cutoff(pid)
			ps.approach = text
			M.emit_event({
				event = "approach_noted",
				problemId = pid,
				approach = text,
				elapsedSeconds = M.problem_elapsed_seconds(pid),
			})
			vim.notify("[Arena] Approach noted.", vim.log.levels.INFO)
		end
		if on_done then
			on_done()
		end
	end)
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

local function stage_sample_one(prob_spec)
	vim.fn.mkdir(config.practice_dir, "p")
	local samples = prob_spec.samples or {}
	if #samples > 0 and samples[1].input then
		local input_path = config.practice_dir .. "input.txt"
		local in_lines = vim.split(vim.trim(samples[1].input), "\n", { plain = true })
		vim.fn.writefile(in_lines, input_path)
		vim.cmd("silent! checktime")
	end
end

local function focus_main_code_window()
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

	if M.session.manifest and M.session.manifest.strictOrder then
		local cur_idx = nil
		for idx, id in ipairs(M.session.order) do
			if id == prob_id then
				cur_idx = idx
				break
			end
		end
		if cur_idx and cur_idx > 1 then
			for i = 1, cur_idx - 1 do
				local prev_id = M.session.order[i]
				local prev_ps = M.session.problems[prev_id]
				if prev_ps and prev_ps.state ~= "completed" then
					vim.notify(
						string.format(
							"[Arena] Strict order: Problem %d (%s) must be completed before %s.",
							i,
							prev_ps.spec.title or prev_id,
							ps.spec.title or prob_id
						),
						vim.log.levels.WARN
					)
					return
				end
			end
		end
	end

	if M.stop_active_run then
		M.stop_active_run()
	end
	M.pause_active_clocks()

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

	require("competitive.arena.dashboard").close()
	focus_main_code_window()

	vim.fn.mkdir(config.practice_dir, "p")
	vim.cmd("cd " .. vim.fn.fnameescape(config.practice_dir))
	local cpp_file = M.problem_cpp_path(prob_id)
	vim.cmd("edit " .. vim.fn.fnameescape(cpp_file))
	local code_buf = vim.api.nvim_get_current_buf()

	-- Fallback cutoff: capture first real buffer edit after BufNewFile template load.
	if ps.state ~= "completed" and ps.thinking_seconds == nil and not ps.edit_hook_armed then
		ps.edit_hook_armed = true
		vim.schedule(function()
			if not M.session or not M.session.problems[prob_id] or ps.thinking_seconds ~= nil then
				return
			end
			if not vim.api.nvim_buf_is_valid(code_buf) then
				return
			end
			local initial_tick = vim.api.nvim_buf_get_changedtick(code_buf)
			vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
				buffer = code_buf,
				once = true,
				callback = function()
					if vim.api.nvim_buf_is_valid(code_buf) and vim.api.nvim_buf_get_changedtick(code_buf) ~= initial_tick then
						mark_thinking_cutoff(prob_id)
					end
				end,
			})
		end)
	end

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

	if M.approach_mode() ~= "off" and (ps.approach or "") == "" and not ps.approach_asked then
		vim.schedule(function()
			M.show_problem_card()
		end)
	end
end

function M.open_or_toggle()
	if not M.require_competitive_session() then
		return
	end

	if not M.has_staged_manifest() then
		require("competitive.arena.dashboard").open("stats")
		return
	end

	M.load_manifest_if_needed()
	require("competitive.arena.dashboard").toggle()
end

-- Attach cohesive submodules onto the public `competitive.arena` API.
timer_mod.attach(M)
popup_mod.attach(M)
runner_mod.attach(M)
verdicts_mod.attach(M)

return M
