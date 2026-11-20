-- Hints (<leader>mh), URL opening (<leader>mo), verdict menu (<leader>mv), session closure (<leader>mx), and standing query.

local config = require("competitive.arena.config")

local M = {}

local function unlock_next_hint_rung(arena, pid, ps, hints)
	if ps.hints_used < #hints then
		ps.hints_used = ps.hints_used + 1
		ps.hints_viewed = {}
		for i = 1, ps.hints_used do
			table.insert(ps.hints_viewed, hints[i])
		end
		arena.emit_event({
			event = "hint_used",
			problemId = pid,
			hintsUsed = ps.hints_used,
			totalHints = #hints,
		})
		return true
	end
	return false
end

local function all_problems_completed(arena)
	if not arena.session then
		return false
	end
	for _, pid in ipairs(arena.session.order) do
		local ps = arena.session.problems[pid]
		if not ps or ps.state ~= "completed" then
			return false
		end
	end
	return true
end

function M.attach(arena)
	function arena.request_hint(unwrap_next)
		if not arena.require_active_problem() then
			return
		end
		local manifest = arena.session.manifest
		local pid = arena.session.active_problem_id
		local ps = arena.session.problems[pid]
		local hints = ps.spec.hints or {}

		if manifest.hintsLocked == true or manifest.gradingPolicy == "contest" then
			vim.notify("[Arena] Hints are locked in a checkpoint.", vim.log.levels.INFO)
			return
		end

		if #hints == 0 then
			vim.notify("[Arena] No progressive hints staged for this problem.", vim.log.levels.INFO)
			return
		end

		local hint_popup_already_open = arena.popup.win
			and vim.api.nvim_win_is_valid(arena.popup.win)
			and arena.popup.kind == "hint"

		if ps.hints_used == 0 or unwrap_next == true or hint_popup_already_open then
			unlock_next_hint_rung(arena, pid, ps, hints)
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

		arena.open_popup(
			string.format("Arena Hint Ladder (%d/%d)", ps.hints_used, #hints),
			lines,
			0.66,
			0.45,
			{
				kind = "hint",
				keymaps = {
					["h"] = function()
						if ps.hints_used < #hints then
							arena.request_hint(true)
						else
							vim.notify("[Arena] All hints are already unwrapped.", vim.log.levels.INFO)
						end
					end,
					["<CR>"] = function()
						if ps.hints_used < #hints then
							arena.request_hint(true)
						end
					end,
					["c"] = function()
						arena.show_problem_card()
					end,
				},
			}
		)
	end

	function arena.open_url()
		if not arena.require_active_problem() then
			return
		end
		local pid = arena.session.active_problem_id
		local ps = arena.session.problems[pid]
		local url = ps and ps.spec and ps.spec.url
		config.open_in_browser(url)
	end

	local function finalize_problem_verdict(pid, verdict, ask_reflection)
		local ps = arena.session.problems[pid]
		if not ps then
			return
		end

		arena.pause_active_clocks()
		arena.snapshot_code(pid, "final")

		local finish_after_note = function(note)
			ps.reflection = vim.trim(note or "")
			ps.verdict = verdict
			ps.state = "completed"
			if verdict == "AC" and not ps.solved_at_seconds then
				ps.solved_at_seconds = arena.pooled_elapsed_seconds()
			end
			local elapsed = arena.problem_elapsed_seconds(pid)
			local thinking_sec = ps.thinking_seconds ~= nil and math.max(0, math.min(elapsed, ps.thinking_seconds)) or nil
			table.insert(ps.attempts, {
				attempt = ps.wrong_attempts + (verdict == "AC" and 1 or 0),
				verdict = verdict,
				elapsedSeconds = elapsed,
			})

			arena.emit_event({
				event = "problem_verdict",
				problemId = pid,
				verdict = verdict,
				durationSeconds = elapsed,
				thinkingSeconds = thinking_sec,
				wrongAttempts = ps.wrong_attempts,
				hintsUsed = ps.hints_used,
			})

			if all_problems_completed(arena) then
				arena.write_result_and_close("completed")
			else
				arena.session.active_problem_id = nil
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

	function arena.verdict_prompt()
		if not arena.require_active_problem() then
			return
		end
		arena.close_popup()
		config.setup_highlights()

		local pid = arena.session.active_problem_id
		local ps = arena.session.problems[pid]
		local elapsed_str = arena.format_clock(arena.problem_elapsed_seconds(pid))

		local items = {
			{ key = "a", code = "AC", keep = false, icon = "✅", short = "AC", desc = "Accepted on Online Judge", hl = "ArenaVerdictAC" },
			{ key = "s", code = "SUBMITTED", keep = false, icon = "📤", short = "Submit Code", desc = "Submit code without OJ verdict", hl = "ArenaVerdictSubmit" },
			{ key = "w", code = "WA", keep = true, icon = "❌", short = "WA  (retry)", desc = "Snapshot attempt & keep coding", hl = "ArenaTimerWarn" },
			{ key = "t", code = "TLE", keep = true, icon = "⏱ ", short = "TLE (retry)", desc = "Snapshot attempt & keep coding", hl = "ArenaTimerWarn" },
			{ key = "r", code = "RE", keep = true, icon = "💥", short = "RE  (retry)", desc = "Snapshot attempt & keep coding", hl = "ArenaTimerWarn" },
			{ key = "x", code = "ABANDON", keep = false, icon = "🏳️ ", short = "Give Up / Stuck", desc = "Stop & return code to pi", hl = "ArenaVerdictWA" },
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
				local elapsed = arena.problem_elapsed_seconds(pid)
				local tag = string.format("attempt_%d_%s", ps.wrong_attempts, choice.code)
				arena.snapshot_code(pid, tag)
				table.insert(ps.attempts, {
					attempt = ps.wrong_attempts,
					verdict = choice.code,
					elapsedSeconds = elapsed,
				})
				arena.emit_event({
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

	function arena.write_result_and_close(status)
		if not arena.session then
			return
		end
		arena.stop_active_run()
		arena.pause_active_clocks()
		local paths = config.paths()
		if not paths then
			return
		end

		local problems_out = {}
		for _, pid in ipairs(arena.session.order) do
			local ps = arena.session.problems[pid]
			local dur = arena.problem_elapsed_seconds(pid)
			local snap = arena.timer_snapshot(pid)
			local thinking_sec = ps.thinking_seconds ~= nil and math.max(0, math.min(dur, ps.thinking_seconds)) or nil

			local verdict = ps.verdict
			if not verdict then
				if ps.state == "accepted" then
					arena.snapshot_code(pid, "final")
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
				thinkingSeconds = thinking_sec,
				solvedAtSeconds = ps.solved_at_seconds,
				solved_at_seconds = ps.solved_at_seconds,
				budgetSeconds = ps.spec.timeBudgetSeconds or snap.budget,
				overtimeSeconds = snap.mode ~= "stopwatch" and math.max(0, dur - (ps.spec.timeBudgetSeconds or snap.budget))
					or 0,
				wrongAttempts = ps.wrong_attempts,
				attempts = ps.attempts,
				hintsUsed = ps.hints_used,
				hintsViewed = ps.hints_viewed,
				reflection = ps.reflection,
				approach = (ps.approach or "") ~= "" and ps.approach or nil,
				localJudge = ps.local_judge,
			})
		end

		local result_payload = {
			sessionId = arena.session.manifest.sessionId,
			status = status or "completed",
			pooledElapsedSeconds = arena.pooled_elapsed_seconds(),
			completedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
			problems = problems_out,
		}

		arena.write_json(paths.result_file, result_payload)
		arena.emit_event({
			event = "session_closed",
			sessionId = arena.session.manifest.sessionId,
		})

		arena.stop_background_timer()
		arena.close_popup()
		require("competitive.arena.dashboard").close()
		arena.session = nil

		vim.notify("[Arena] Session completed and returned to pi!", vim.log.levels.INFO)
	end

	function arena.close_session()
		if not arena.require_active_arena() then
			return
		end

		local unresolved = {}
		for _, pid in ipairs(arena.session.order) do
			local ps = arena.session.problems[pid]
			if ps.state ~= "completed" then
				table.insert(unresolved, ps.spec.title .. " (" .. pid .. ")")
			end
		end

		if #unresolved == 0 then
			arena.write_result_and_close("completed")
			return
		end

		local choice = vim.fn.confirm(
			string.format("Close Arena & submit current code to pi? (%d unresolved: %s)", #unresolved, table.concat(unresolved, ", ")),
			"&Yes\n&Cancel",
			1
		)
		if choice == 1 then
			arena.write_result_and_close("completed")
		end
	end

	function arena.fetch_standing_sync()
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
end

return M
