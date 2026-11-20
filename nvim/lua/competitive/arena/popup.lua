-- Singleton floating popup window and Problem Card renderer for Arena.

local config = require("competitive.arena.config")

local M = {}

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

local function apply_popup_highlights(buf, wrapped_lines)
	local ns = vim.api.nvim_create_namespace("ArenaPopupHighlights")
	vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
	for idx, l in ipairs(wrapped_lines) do
		local trimmed = vim.trim(l)
		local hl = nil
		local smp_pass, smp_tot = string.match(trimmed, "^Summary:%s*(%d+)%s*/%s*(%d+)%s+samples passed")

		if idx == 1 then
			if string.find(trimmed, ": AC$", 1) then
				hl = "ArenaVerdictAC"
			elseif
				string.find(trimmed, ": WA$", 1)
				or string.find(trimmed, ": TLE$", 1)
				or string.find(trimmed, ": RE$", 1)
				or vim.startswith(trimmed, "Compilation Failed")
			then
				hl = "ArenaVerdictWA"
			else
				hl = "ArenaSubheader"
			end
		elseif smp_pass and smp_tot then
			hl = (smp_pass == smp_tot) and "ArenaVerdictAC" or "ArenaVerdictWA"
		elseif string.find(l, "─", 1, true) then
			hl = "ArenaMuted"
		elseif string.sub(trimmed, 1, 2) == "\226\160" then
			-- Braille spinner frames U+2800..U+283F start with UTF-8 bytes 0xE2 0xA0 (\226\160).
			hl = "ArenaTimerWarn"
		elseif vim.startswith(trimmed, "▾ Hint") then
			hl = "ArenaVerdictAC"
		elseif
			vim.startswith(trimmed, "✓")
			and string.find(l, "✗", 1, true)
			or (vim.startswith(trimmed, "✗") and string.find(l, "✓", 1, true))
		then
			local pos = 1
			while pos <= #l do
				local na = string.find(l, "✓", pos, true)
				local nw = string.find(l, "✗", pos, true)
				local cur_s, cur_hl, next_s
				if na and (not nw or na < nw) then
					cur_s, cur_hl = na, "ArenaVerdictAC"
					local na2 = string.find(l, "✓", na + 3, true)
					next_s = (na2 and nw) and math.min(na2, nw) or (na2 or nw)
				elseif nw then
					cur_s, cur_hl = nw, "ArenaVerdictWA"
					local nw2 = string.find(l, "✗", nw + 3, true)
					next_s = (na and nw2) and math.min(na, nw2) or (na or nw2)
				else
					break
				end
				local cur_e = next_s and (next_s - 1) or #l
				pcall(vim.api.nvim_buf_add_highlight, buf, ns, cur_hl, idx - 1, cur_s - 1, cur_e)
				pos = cur_e + 1
			end
		elseif vim.startswith(trimmed, "✓") then
			hl = "ArenaVerdictAC"
		elseif vim.startswith(trimmed, "✗") then
			hl = "ArenaVerdictWA"
		elseif
			vim.startswith(trimmed, "🔒 Hint")
			or vim.startswith(trimmed, "[h / Enter]")
			or vim.startswith(trimmed, "[r]")
			or vim.startswith(trimmed, "(")
		then
			hl = "ArenaMuted"
		end
		if hl then
			pcall(vim.api.nvim_buf_add_highlight, buf, ns, hl, idx - 1, 0, -1)
		end
	end
end

function M.attach(arena)
	arena.popup = {
		win = nil,
		buf = nil,
		kind = nil,
		problem_id = nil,
		on_close = nil,
		custom_keys = {},
	}

	function arena.close_popup()
		local win = arena.popup.win
		local on_close = arena.popup.on_close
		arena.popup.win = nil
		arena.popup.buf = nil
		arena.popup.kind = nil
		arena.popup.problem_id = nil
		arena.popup.on_close = nil
		arena.popup.custom_keys = {}
		if win and vim.api.nvim_win_is_valid(win) then
			pcall(vim.api.nvim_win_close, win, true)
		end
		if on_close then
			vim.schedule(on_close)
		end
	end

	function arena.open_popup(title, lines, width_ratio, height_ratio, opts)
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
		local win_title = " " .. title .. " (" .. (opts.close_hint or "q / Esc close") .. ") "

		local reuse = arena.popup.win
			and vim.api.nvim_win_is_valid(arena.popup.win)
			and arena.popup.buf
			and vim.api.nvim_buf_is_valid(arena.popup.buf)

		if opts.refresh_only and not reuse then
			return
		end

		local buf, win
		if reuse then
			buf = arena.popup.buf
			win = arena.popup.win
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
			arena.close_popup()
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
						if arena.popup.win == win then
							arena.close_popup()
						end
					end)
				end,
			})
		end

		local prev_kind = arena.popup.kind
		local prev_on_close = arena.popup.on_close
		local new_kind = opts.kind or prev_kind or "generic"

		arena.popup.win = win
		arena.popup.buf = buf
		arena.popup.kind = new_kind
		arena.popup.problem_id = opts.problem_id
		if not opts.refresh_only then
			arena.popup.on_close = opts.on_close
			if reuse and prev_on_close and prev_kind ~= new_kind then
				vim.schedule(prev_on_close)
			end
		end

		vim.bo[buf].modifiable = true
		vim.api.nvim_buf_set_lines(buf, 0, -1, false, wrapped_lines)
		vim.bo[buf].modifiable = false

		apply_popup_highlights(buf, wrapped_lines)

		if not opts.refresh_only then
			if vim.api.nvim_get_current_win() ~= win then
				pcall(vim.api.nvim_set_current_win, win)
			end
			if opts.cursor_line then
				local target = math.max(1, math.min(#wrapped_lines, opts.cursor_line))
				pcall(vim.api.nvim_win_set_cursor, win, { target, 2 })
			end

			if arena.popup.custom_keys then
				for _, lhs in ipairs(arena.popup.custom_keys) do
					pcall(vim.keymap.del, "n", lhs, { buffer = buf })
				end
			end
			arena.popup.custom_keys = {}

			local key_opts = { buffer = buf, nowait = true, silent = true }
			vim.keymap.set("n", "q", arena.close_popup, key_opts)
			vim.keymap.set("n", "<Esc>", arena.close_popup, key_opts)

			if opts.keymaps then
				for lhs, fn in pairs(opts.keymaps) do
					vim.keymap.set("n", lhs, fn, key_opts)
					table.insert(arena.popup.custom_keys, lhs)
				end
			end
		end
	end

	function arena.show_problem_card()
		if not arena.require_active_problem() then
			return
		end
		local pid = arena.session.active_problem_id
		local ps = arena.session.problems[pid]
		local spec = ps.spec
		local blind = arena.session.manifest.blindMetadata == true
		local snap = arena.timer_snapshot(pid)

		local clock_str = snap.mode == "stopwatch" and ("Elapsed: " .. arena.format_clock(snap.elapsed))
			or (
				snap.is_overtime and ("OVERTIME: +" .. arena.format_clock(snap.overtime))
				or ("Remaining: " .. arena.format_clock(snap.remaining) .. " / " .. arena.format_clock(snap.budget))
			)

		local diff_num = tonumber(spec.difficulty)
		local domain_str = type(spec.domain) == "string" and spec.domain or "—"
		local meta_str = blind and "Difficulty & Domain: [BLIND CHECKPOINT MODE]"
			or string.format("Difficulty: %s  |  Domain: %s", diff_num and ("CF " .. diff_num) or "—", domain_str)

		local lines = {
			string.format("  Problem:  %s  (%s.cpp)", spec.title, pid),
			string.format("  Platform: %s  |  ⏱ %s", spec.platform or "Judge", clock_str),
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

		if arena.approach_mode() ~= "off" then
			table.insert(lines, "  " .. string.rep("─", 64))
			local shown = (ps.approach or "") ~= "" and ps.approach or "(optional — press p or <leader>mp to jot one)"
			table.insert(lines, "  Your approach: " .. shown)
		end

		local has_tests = type(spec.testsDir) == "string" and spec.testsDir ~= ""
		table.insert(lines, "  " .. string.rep("─", 64))
		table.insert(
			lines,
			"  [h] Hints   [t] Samples   "
				.. (has_tests and "[r] Hidden tests   " or "")
				.. (arena.approach_mode() ~= "off" and "[p] Approach   " or "")
				.. "[o] URL   [v] Verdict   [q] Close"
		)

		arena.open_popup("Arena Problem Card — " .. spec.title, lines, 0.72, 0.65, {
			kind = "card",
			problem_id = pid,
			on_close = function()
				if arena.approach_mode() ~= "off" and (ps.approach or "") == "" and not ps.approach_asked then
					arena.prompt_approach()
				end
			end,
			keymaps = {
				["h"] = function()
					arena.popup.on_close = nil
					arena.request_hint(false)
				end,
				["t"] = function()
					arena.popup.on_close = nil
					arena.test_samples()
				end,
				["r"] = function()
					arena.popup.on_close = nil
					arena.judge_hidden()
				end,
				["J"] = function()
					arena.popup.on_close = nil
					arena.judge_hidden()
				end,
				["p"] = function()
					ps.approach_asked = true
					arena.popup.on_close = nil
					arena.close_popup()
					arena.prompt_approach()
				end,
				["o"] = function()
					arena.open_url()
				end,
				["v"] = function()
					arena.popup.on_close = nil
					arena.close_popup()
					arena.verdict_prompt()
				end,
			},
		})
	end
end

return M
