-- Asynchronous compile, sample runner (<leader>mt), and hidden-test judge (<leader>mj) for Arena.

local config = require("competitive.arena.config")

local M = {}

local SPINNER_FRAMES = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }

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

local function now_ms()
	local uv = vim.uv or vim.loop
	if uv and uv.hrtime then
		return uv.hrtime() / 1e6
	end
	return os.time() * 1000
end

local function render_progress_bar(done, total, width)
	width = width or 24
	total = math.max(1, total)
	local filled = math.max(0, math.min(width, math.floor((done / total) * width + 0.5)))
	return "[" .. string.rep("█", filled) .. string.rep("░", width - filled) .. "]"
end

local function format_badge_rows(badges, per_row, max_badges)
	local rows = {}
	local total = #badges
	local start_idx = math.max(1, total - (max_badges or 20) + 1)
	if start_idx > 1 then
		table.insert(rows, string.format("  (… %d earlier passed)", start_idx - 1))
	end
	local cur = {}
	for i = start_idx, total do
		table.insert(cur, string.format("%-15s", badges[i]))
		if #cur >= (per_row or 4) then
			table.insert(rows, "  " .. table.concat(cur, "  "))
			cur = {}
		end
	end
	if #cur > 0 then
		table.insert(rows, "  " .. table.concat(cur, "  "))
	end
	return rows
end

local function read_text(path)
	local ok, lines = pcall(vim.fn.readfile, path)
	if not ok or not lines then
		return ""
	end
	return table.concat(lines, "\n")
end

local function write_text(path, text)
	pcall(vim.fn.writefile, vim.split(text or "", "\n", { plain = true }), path)
end

local function clip_lines(text, max_lines, max_chars)
	local out = {}
	local total = 0
	for _, l in ipairs(vim.split(text or "", "\n", { plain = true })) do
		if #out >= max_lines or total >= max_chars then
			table.insert(out, "    … (truncated)")
			break
		end
		total = total + #l
		table.insert(out, "    " .. l)
	end
	return out
end

function M.attach(arena)
	local active_run = nil

	function arena.stop_active_run(notify_msg)
		local r = active_run
		if not r then
			return
		end
		active_run = nil
		r.cancelled = true
		if r.spin_timer then
			pcall(function()
				r.spin_timer:stop()
				r.spin_timer:close()
			end)
			r.spin_timer = nil
		end
		if r.job_id and r.job_id > 0 then
			pcall(vim.fn.jobstop, r.job_id)
			r.job_id = nil
		end
		if notify_msg then
			vim.notify(notify_msg, vim.log.levels.INFO)
		end
	end

	local function is_run_alive(run_state)
		return active_run == run_state and not run_state.cancelled
	end

	local function start_spinner_loop(run_state, render_live)
		local uv = vim.uv or vim.loop
		run_state.spin_timer = uv.new_timer()
		run_state.spin_timer:start(
			120,
			120,
			vim.schedule_wrap(function()
				if not is_run_alive(run_state) then
					return
				end
				run_state.frame = (run_state.frame % #SPINNER_FRAMES) + 1
				render_live(false)
			end)
		)
	end

	local function show_compile_error(popup_title, header, err_text)
		arena.popup.on_close = nil
		arena.stop_active_run()
		local err_lines = { header, string.rep("─", 64) }
		for _, l in ipairs(vim.split(err_text or "", "\n", { plain = true })) do
			table.insert(err_lines, l)
		end
		arena.open_popup(popup_title, err_lines, 0.72, 0.55)
	end

	local function async_compile(cpp_path, bin_path, run_state, on_ok, on_err)
		local compile_cmd = string.format(
			"%s %s -o %s %s",
			config.compiler or "g++",
			vim.fn.shellescape(cpp_path),
			vim.fn.shellescape(bin_path),
			config.compile_flags or "-std=c++17 -Wshadow -Wall -O2 -Wno-unused-result -Winvalid-pch"
		)
		local out_chunks = {}
		local err_chunks = {}
		local jid = vim.fn.jobstart({ "sh", "-c", compile_cmd }, {
			stdout_buffered = true,
			stderr_buffered = true,
			on_stdout = function(_, data)
				if data then
					vim.list_extend(out_chunks, data)
				end
			end,
			on_stderr = function(_, data)
				if data then
					vim.list_extend(err_chunks, data)
				end
			end,
			on_exit = vim.schedule_wrap(function(_, code)
				if not is_run_alive(run_state) then
					return
				end
				run_state.job_id = nil
				if code ~= 0 then
					local combined = {}
					for _, l in ipairs(err_chunks) do
						if l ~= "" then
							table.insert(combined, l)
						end
					end
					for _, l in ipairs(out_chunks) do
						if l ~= "" then
							table.insert(combined, l)
						end
					end
					on_err(table.concat(combined, "\n"))
				else
					on_ok()
				end
			end),
		})
		if jid <= 0 then
			on_err("Failed to start compiler process.")
			return
		end
		run_state.job_id = jid
	end

	function arena.test_samples()
		if not arena.require_active_problem() then
			return
		end
		vim.cmd("silent! update")

		local pid = arena.session.active_problem_id
		local ps = arena.session.problems[pid]
		local spec = ps.spec
		local samples = spec.samples or {}

		if #samples == 0 then
			vim.notify("[Arena] No manifest samples attached — use <leader>ct with input.txt.", vim.log.levels.WARN)
			return
		end

		arena.stop_active_run()

		local cpp_path = arena.problem_cpp_path(pid)
		local bin_dir = config.practice_dir .. "bin"
		vim.fn.mkdir(bin_dir, "p")
		local bin_path = bin_dir .. "/" .. pid
		local limit = 3

		local run_state = {
			kind = "samples",
			phase = "compile",
			idx = 0,
			total = #samples,
			passed = 0,
			frame = 1,
			step_started_ms = now_ms(),
			badges = {},
			cancelled = false,
			job_id = nil,
			spin_timer = nil,
		}
		active_run = run_state

		local function render_live(is_initial)
			if not is_run_alive(run_state) then
				return
			end
			local spin = SPINNER_FRAMES[run_state.frame]
			local step_sec = math.max(0, (now_ms() - run_state.step_started_ms) / 1000)
			local bar = render_progress_bar(run_state.phase == "compile" and 0 or (run_state.idx - 1), run_state.total, 20)
			local status_line
			if run_state.phase == "compile" then
				status_line = string.format("  %s %s  Compiling %s.cpp… (%.1fs)", spin, bar, pid, step_sec)
			else
				status_line = string.format(
					"  %s %s  Running Sample %d / %d (%.1fs / %ds)…",
					spin,
					bar,
					run_state.idx,
					run_state.total,
					step_sec,
					limit
				)
			end

			local lines = {
				string.format("  Sample Test Runner — %s (%s.cpp)", spec.title, pid),
				"  " .. string.rep("─", 62),
				status_line,
				"",
			}
			if #run_state.badges > 0 then
				vim.list_extend(lines, format_badge_rows(run_state.badges, 4, 16))
				table.insert(lines, "")
			end
			table.insert(lines, "  (Press q or Esc to cancel)")

			local title_progress = run_state.phase == "compile" and "Compiling…"
				or string.format("%d/%d", run_state.idx - 1, run_state.total)
			arena.open_popup("Arena Samples — " .. title_progress, lines, 0.68, 0.45, {
				kind = "samples_running",
				close_hint = "q / Esc cancel",
				refresh_only = not is_initial,
				on_close = function()
					if active_run == run_state then
						arena.stop_active_run("[Arena] Sample test run cancelled.")
					end
				end,
			})
		end

		render_live(true)
		start_spinner_loop(run_state, render_live)

		local report_lines = {
			string.format("Sample Test Results for %s (%s.cpp)", spec.title, pid),
			string.rep("─", 64),
		}
		local details = {}

		local function finish_samples()
			if not is_run_alive(run_state) then
				return
			end
			arena.popup.on_close = nil
			arena.stop_active_run()

			table.insert(report_lines, 2, string.format("Summary: %d / %d samples passed", run_state.passed, #samples))
			ps.sample_results = { passed = run_state.passed, total = #samples, details = details }

			arena.emit_event({
				event = "samples_tested",
				problemId = pid,
				passed = run_state.passed,
				total = #samples,
			})

			table.insert(report_lines, string.rep("─", 64))
			table.insert(report_lines, "  [r] Re-run   [c] Problem Card   [v] Verdict   [q / Esc] Close")

			arena.open_popup(
				string.format("Arena Samples (%d/%d Passed)", run_state.passed, #samples),
				report_lines,
				0.68,
				0.56,
				{
					kind = "samples",
					keymaps = {
						["r"] = function()
							arena.test_samples()
						end,
						["c"] = function()
							arena.show_problem_card()
						end,
						["v"] = function()
							arena.close_popup()
							arena.verdict_prompt()
						end,
					},
				}
			)
		end

		local function run_sample_at(idx)
			if not is_run_alive(run_state) then
				return
			end
			if idx > #samples then
				finish_samples()
				return
			end

			run_state.idx = idx
			run_state.step_started_ms = now_ms()
			render_live(false)

			local smp = samples[idx]
			local case_start_ms = now_ms()
			local out_chunks = {}

			local jid = vim.fn.jobstart({ "timeout", "--kill-after=0.2s", tostring(limit) .. "s", bin_path }, {
				stdout_buffered = true,
				on_stdout = function(_, data)
					if data then
						vim.list_extend(out_chunks, data)
					end
				end,
				on_exit = vim.schedule_wrap(function(_, exit_code)
					if not is_run_alive(run_state) then
						return
					end
					run_state.job_id = nil
					local case_ms = math.max(1, math.floor(now_ms() - case_start_ms + 0.5))
					local actual_raw = table.concat(out_chunks, "\n")
					local expected_norm = normalize_output(smp.output or "")
					local actual_norm = normalize_output(actual_raw or "")
					local is_tle = (exit_code == 124 or exit_code == 137)
					local ok = (exit_code == 0) and oj_outputs_match(smp.output or "", actual_raw or "")

					if ok then
						run_state.passed = run_state.passed + 1
						table.insert(run_state.badges, string.format("✓ S%d (%dms)", idx, case_ms))
						table.insert(report_lines, string.format("✓ Sample %d: PASS (%dms)", idx, case_ms))
						table.insert(details, { sample = idx, passed = true, durationMs = case_ms })
					else
						local short_err = is_tle and "TLE" or (exit_code ~= 0 and "RE" or "WA")
						table.insert(run_state.badges, string.format("✗ S%d (%s)", idx, short_err))
						local status_label = is_tle and string.format("TLE (>%ds)", limit)
							or (exit_code ~= 0 and ("RE (exit " .. tostring(exit_code) .. ")") or "WA (Output Mismatch)")
						table.insert(report_lines, string.format("✗ Sample %d: FAIL — %s (%dms)", idx, status_label, case_ms))
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
						table.insert(details, { sample = idx, passed = false, reason = status_label, durationMs = case_ms })
					end

					run_sample_at(idx + 1)
				end),
			})

			if jid <= 0 then
				arena.popup.on_close = nil
				arena.stop_active_run("[Arena] Failed to launch sample binary.")
				return
			end
			run_state.job_id = jid
			local raw_in = tostring(smp.input or "")
			if raw_in ~= "" and not string.match(raw_in, "\n$") then
				raw_in = raw_in .. "\n"
			end
			pcall(vim.fn.chansend, jid, raw_in)
			pcall(vim.fn.chanclose, jid, "stdin")
		end

		async_compile(cpp_path, bin_path, run_state, function()
			run_state.phase = "test"
			run_sample_at(1)
		end, function(compile_out)
			show_compile_error("Arena Sample Runner — Compile Error", "Compilation Failed (" .. pid .. ".cpp):", compile_out)
		end)
	end

	function arena.judge_hidden()
		if not arena.require_active_problem() then
			return
		end
		vim.cmd("silent! update")

		local pid = arena.session.active_problem_id
		local ps = arena.session.problems[pid]
		local spec = ps.spec
		local tests_dir = type(spec.testsDir) == "string" and spec.testsDir or ""
		if tests_dir == "" or vim.fn.isdirectory(tests_dir) ~= 1 then
			local pfx = config.keymap_prefix or "<leader>m"
			vim.notify("[Arena] No hidden tests for this problem — " .. pfx .. "t runs the samples.", vim.log.levels.INFO)
			return
		end

		local inputs = vim.fn.glob(tests_dir .. "/*.in", false, true)
		if #inputs == 0 then
			vim.notify("[Arena] The hidden-test folder has no .in files.", vim.log.levels.WARN)
			return
		end
		table.sort(inputs, function(a, b)
			local sa, sb = vim.fn.getfsize(a), vim.fn.getfsize(b)
			if sa ~= sb then
				return sa < sb
			end
			return a < b
		end)

		arena.stop_active_run()

		local cpp_path = arena.problem_cpp_path(pid)
		local bin_dir = config.practice_dir .. "bin"
		vim.fn.mkdir(bin_dir, "p")
		local bin_path = bin_dir .. "/" .. pid
		local limit = tonumber(spec.timeLimitSeconds) or 2

		local checker_cpp = tests_dir .. "/checker.cpp"
		local checker_py = tests_dir .. "/checker.py"
		local checker_sh = tests_dir .. "/checker.sh"
		local checker_bin = bin_dir .. "/" .. pid .. "_checker"
		local has_checker_cpp = vim.fn.filereadable(checker_cpp) == 1
		local has_checker_py = vim.fn.filereadable(checker_py) == 1
		local has_checker_sh = vim.fn.filereadable(checker_sh) == 1
		local has_any_checker = has_checker_cpp or has_checker_py or has_checker_sh

		local run_state = {
			kind = "judge",
			phase = "compile",
			idx = 0,
			total = #inputs,
			cur_name = "",
			passed = 0,
			max_ms = 0,
			frame = 1,
			step_started_ms = now_ms(),
			badges = {},
			cancelled = false,
			job_id = nil,
			spin_timer = nil,
		}
		active_run = run_state

		local function render_live(is_initial)
			if not is_run_alive(run_state) then
				return
			end
			local spin = SPINNER_FRAMES[run_state.frame]
			local step_sec = math.max(0, (now_ms() - run_state.step_started_ms) / 1000)
			local bar = render_progress_bar(run_state.passed, run_state.total, 24)
			local status_line
			if run_state.phase == "compile" then
				status_line = string.format("  %s %s  Compiling %s.cpp… (%.1fs)", spin, bar, pid, step_sec)
			else
				status_line = string.format(
					"  %s %s  %d / %d passed  ·  Running %s (%.1fs / %ss)…",
					spin,
					bar,
					run_state.passed,
					run_state.total,
					run_state.cur_name,
					step_sec,
					tostring(limit)
				)
			end

			local lines = {
				string.format("  Hidden Test Judge — %s (%s.cpp)", spec.title, pid),
				"  " .. string.rep("─", 64),
				status_line,
				"",
			}
			if #run_state.badges > 0 then
				vim.list_extend(lines, format_badge_rows(run_state.badges, 4, 20))
				table.insert(lines, "")
			else
				table.insert(
					lines,
					string.format("  Suite: %d hidden tests (smallest input first)  ·  Limit: %ss / test", #inputs, tostring(limit))
				)
				table.insert(lines, "")
			end
			table.insert(lines, "  (Press q or Esc to cancel)")

			local title_progress = run_state.phase == "compile" and "Compiling…"
				or string.format("%d/%d", run_state.passed, run_state.total)
			arena.open_popup("Arena Hidden Tests — " .. title_progress, lines, 0.70, 0.50, {
				kind = "judge_running",
				close_hint = "q / Esc cancel",
				refresh_only = not is_initial,
				on_close = function()
					if active_run == run_state then
						arena.stop_active_run("[Arena] Hidden test run cancelled.")
					end
				end,
			})
		end

		render_live(true)
		start_spinner_loop(run_state, render_live)

		local function finish_judge(failure)
			if not is_run_alive(run_state) then
				return
			end
			arena.popup.on_close = nil
			arena.stop_active_run()

			local verdict = failure and failure.status or "AC"
			ps.local_judge = {
				verdict = verdict,
				passed = run_state.passed,
				total = #inputs,
				failedCase = failure and failure.name or nil,
			}
			arena.emit_event({
				event = "judged",
				problemId = pid,
				verdict = verdict,
				passed = run_state.passed,
				total = #inputs,
			})

			local blind = arena.session.manifest.gradingPolicy == "contest"
			local lines = {
				string.format("Hidden tests for %s (%s.cpp): %s", spec.title, pid, verdict),
				string.rep("─", 64),
			}
			if not failure then
				table.insert(
					lines,
					string.format(
						"✓ All %d tests passed (peak %dms, limit %ss per test).",
						#inputs,
						run_state.max_ms,
						tostring(limit)
					)
				)
				if #run_state.badges > 0 then
					table.insert(lines, "")
					vim.list_extend(lines, format_badge_rows(run_state.badges, 4, 24))
				end
			else
				table.insert(
					lines,
					string.format(
						"✗ Test %s: %s (%dms) after %d / %d passed.",
						failure.name,
						failure.status,
						failure.duration_ms or 0,
						run_state.passed,
						#inputs
					)
				)
				if blind then
					table.insert(lines, "  (Checkpoint: the failing case stays hidden.)")
				else
					table.insert(lines, "  Input:")
					vim.list_extend(lines, clip_lines(failure.input, 30, 2000))
					table.insert(lines, "  Expected:")
					vim.list_extend(lines, clip_lines(normalize_output(failure.expected), 15, 1200))
					table.insert(lines, "  Got:")
					vim.list_extend(lines, clip_lines(normalize_output(failure.actual), 15, 1200))
					if failure.checker_msg and failure.checker_msg ~= "" then
						table.insert(lines, "  Checker Verdict:")
						vim.list_extend(lines, clip_lines(failure.checker_msg, 6, 600))
					end
				end
			end
			table.insert(lines, string.rep("─", 64))
			table.insert(lines, "  [r] Re-run   [c] Problem Card   [v] Verdict   [q / Esc] Close")
			arena.open_popup(
				string.format("Arena Hidden Tests (%d/%d — %s)", run_state.passed, #inputs, verdict),
				lines,
				0.70,
				0.60,
				{
					kind = "judge",
					keymaps = {
						["r"] = function()
							arena.judge_hidden()
						end,
						["c"] = function()
							arena.show_problem_card()
						end,
						["v"] = function()
							arena.close_popup()
							arena.verdict_prompt()
						end,
					},
				}
			)
		end

		local function run_case_at(idx)
			if not is_run_alive(run_state) then
				return
			end
			if idx > #inputs then
				finish_judge(nil)
				return
			end

			local input_path = inputs[idx]
			local expected_path = input_path:gsub("%.in$", ".out")
			local case_stem = vim.fn.fnamemodify(input_path, ":t:r")

			run_state.idx = idx
			run_state.cur_name = vim.fn.fnamemodify(input_path, ":t")
			run_state.step_started_ms = now_ms()
			render_live(false)

			local case_start_ms = now_ms()
			local out_chunks = {}
			local actual_out_path = bin_dir .. "/" .. pid .. "_actual.out"
			local shell_cmd = string.format(
				"exec timeout --kill-after=0.2s %ss %s < %s 2>/dev/null",
				tostring(limit),
				vim.fn.shellescape(bin_path),
				vim.fn.shellescape(input_path)
			)

			local jid = vim.fn.jobstart({ "sh", "-c", shell_cmd }, {
				stdout_buffered = true,
				on_stdout = function(_, data)
					if data then
						vim.list_extend(out_chunks, data)
					end
				end,
				on_exit = vim.schedule_wrap(function(_, code)
					if not is_run_alive(run_state) then
						return
					end
					run_state.job_id = nil
					local case_ms = math.max(1, math.floor(now_ms() - case_start_ms + 0.5))
					local actual = table.concat(out_chunks, "\n")
					local expected = read_text(expected_path)
					local is_tle = (code == 124 or code == 137)

					if code ~= 0 then
						finish_judge({
							name = case_stem,
							status = is_tle and "TLE" or "RE",
							duration_ms = case_ms,
							input = read_text(input_path),
							expected = expected,
							actual = actual or "",
						})
						return
					end

					local function on_verdict(ok, checker_msg)
						if ok then
							run_state.passed = run_state.passed + 1
							if case_ms > run_state.max_ms then
								run_state.max_ms = case_ms
							end
							table.insert(run_state.badges, string.format("✓ %s (%dms)", case_stem, case_ms))
							run_case_at(idx + 1)
						else
							finish_judge({
								name = case_stem,
								status = "WA",
								duration_ms = case_ms,
								input = read_text(input_path),
								expected = expected,
								actual = actual or "",
								checker_msg = checker_msg,
							})
						end
					end

					if has_any_checker then
						write_text(actual_out_path, actual)
						local checker_cmd
						if has_checker_cpp then
							checker_cmd = string.format(
								"%s %s %s %s 2>&1",
								vim.fn.shellescape(checker_bin),
								vim.fn.shellescape(input_path),
								vim.fn.shellescape(actual_out_path),
								vim.fn.shellescape(expected_path)
							)
						elseif has_checker_py then
							checker_cmd = string.format(
								"python3 %s %s %s %s 2>&1",
								vim.fn.shellescape(checker_py),
								vim.fn.shellescape(input_path),
								vim.fn.shellescape(actual_out_path),
								vim.fn.shellescape(expected_path)
							)
						else
							checker_cmd = string.format(
								"sh %s %s %s %s 2>&1",
								vim.fn.shellescape(checker_sh),
								vim.fn.shellescape(input_path),
								vim.fn.shellescape(actual_out_path),
								vim.fn.shellescape(expected_path)
							)
						end

						local chk_chunks = {}
						vim.fn.jobstart({ "sh", "-c", checker_cmd }, {
							stdout_buffered = true,
							on_stdout = function(_, data)
								if data then
									vim.list_extend(chk_chunks, data)
								end
							end,
							on_exit = vim.schedule_wrap(function(_, chk_code)
								if not is_run_alive(run_state) then
									return
								end
								local chk_msg = vim.trim(table.concat(chk_chunks, "\n"))
								on_verdict(chk_code == 0, chk_msg)
							end),
						})
					else
						on_verdict(oj_outputs_match(expected, actual), nil)
					end
				end),
			})

			if jid <= 0 then
				arena.popup.on_close = nil
				arena.stop_active_run("[Arena] Failed to launch hidden-test process.")
				return
			end
			run_state.job_id = jid
		end

		local function start_test_suite()
			run_state.phase = "test"
			run_case_at(1)
		end

		async_compile(cpp_path, bin_path, run_state, function()
			if has_checker_cpp then
				local compile_checker_cmd = string.format(
					"exec g++ -std=c++17 -O2 %s -o %s 2>&1",
					vim.fn.shellescape(checker_cpp),
					vim.fn.shellescape(checker_bin)
				)
				local chk_compile_chunks = {}
				vim.fn.jobstart({ "sh", "-c", compile_checker_cmd }, {
					stdout_buffered = true,
					on_stdout = function(_, data)
						if data then
							vim.list_extend(chk_compile_chunks, data)
						end
					end,
					on_exit = vim.schedule_wrap(function(_, code)
						if not is_run_alive(run_state) then
							return
						end
						if code == 0 then
							start_test_suite()
						else
							show_compile_error(
								"Arena Hidden Tests — Checker Compile Error",
								"Checker Compilation Failed (checker.cpp):",
								table.concat(chk_compile_chunks, "\n")
							)
						end
					end),
				})
			else
				start_test_suite()
			end
		end, function(compile_out)
			show_compile_error("Arena Hidden Tests — Compile Error", "Compilation Failed (" .. pid .. ".cpp):", compile_out)
		end)
	end
end

return M
