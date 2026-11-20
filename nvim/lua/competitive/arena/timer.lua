-- Timer, elapsed clock calculation, and background tick updates for Arena.

local M = {}

function M.attach(arena)
	local timer_handle = nil

	function arena.format_clock(seconds)
		local s = math.max(0, math.floor(tonumber(seconds) or 0))
		local m = math.floor(s / 60)
		local rem = s % 60
		return string.format("%02d:%02d", m, rem)
	end

	function arena.problem_elapsed_seconds(prob_id)
		if not arena.session or not arena.session.problems[prob_id] then
			return 0
		end
		local ps = arena.session.problems[prob_id]
		local total = ps.accumulated_seconds or 0
		if ps.started_at then
			total = total + math.max(0, os.time() - ps.started_at)
		end
		return total
	end

	function arena.pooled_elapsed_seconds()
		if not arena.session then
			return 0
		end
		local total = arena.session.pooled_accumulated_seconds or 0
		if arena.session.pooled_started_at then
			total = total + math.max(0, os.time() - arena.session.pooled_started_at)
		end
		return total
	end

	function arena.timer_snapshot(prob_id)
		if not arena.session then
			return { mode = "stopwatch", elapsed = 0, budget = 0, remaining = 0, overtime = 0, is_overtime = false }
		end
		local manifest = arena.session.manifest
		local mode = manifest.timerMode or "stopwatch"
		local pid = prob_id or arena.session.active_problem_id

		if mode == "pooled" then
			local elapsed = arena.pooled_elapsed_seconds()
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

		local elapsed = pid and arena.problem_elapsed_seconds(pid) or 0
		local ps = pid and arena.session.problems[pid] or nil
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

	function arena.pause_active_clocks()
		if not arena.session then
			return
		end
		local now = os.time()
		if arena.session.active_problem_id then
			local ps = arena.session.problems[arena.session.active_problem_id]
			if ps and ps.started_at then
				ps.accumulated_seconds = (ps.accumulated_seconds or 0) + math.max(0, now - ps.started_at)
				ps.started_at = nil
			end
		end
		if arena.session.pooled_started_at then
			arena.session.pooled_accumulated_seconds = (arena.session.pooled_accumulated_seconds or 0)
				+ math.max(0, now - arena.session.pooled_started_at)
			arena.session.pooled_started_at = nil
		end
	end

	function arena.stop_background_timer()
		if timer_handle then
			pcall(function()
				timer_handle:stop()
				timer_handle:close()
			end)
			timer_handle = nil
		end
	end

	function arena.start_background_timer()
		if timer_handle then
			return
		end
		local uv = vim.uv or vim.loop
		timer_handle = uv.new_timer()
		timer_handle:start(
			1000,
			1000,
			vim.schedule_wrap(function()
				if not arena.session then
					arena.stop_background_timer()
					return
				end
				-- If active manifest was removed externally (e.g. /arena cancel), clean up
				if not arena.has_staged_manifest() then
					arena.session = nil
					arena.stop_background_timer()
					return
				end

				local pid = arena.session.active_problem_id
				if pid then
					local snap = arena.timer_snapshot(pid)
					local ps = arena.session.problems[pid]
					if snap.is_overtime and ps and not ps.overtime_notified then
						ps.overtime_notified = true
						vim.notify(
							string.format(
								"[Arena] Time budget (%s) reached for %s — now in OVERTIME. Finish your thought and submit when ready!",
								arena.format_clock(snap.budget),
								ps.spec.title
							),
							vim.log.levels.WARN
						)
					end
				end

				-- Live update problem card if open
				if arena.popup and arena.popup.kind == "card" and arena.popup.buf and vim.api.nvim_buf_is_valid(arena.popup.buf) then
					local card_pid = arena.popup.problem_id or arena.session.active_problem_id
					if card_pid and arena.session.problems[card_pid] then
						local cur_ps = arena.session.problems[card_pid]
						local cur_snap = arena.timer_snapshot(card_pid)
						local c_str = cur_snap.mode == "stopwatch" and ("Elapsed: " .. arena.format_clock(cur_snap.elapsed))
							or (
								cur_snap.is_overtime and ("OVERTIME: +" .. arena.format_clock(cur_snap.overtime))
								or ("Remaining: " .. arena.format_clock(cur_snap.remaining) .. " / " .. arena.format_clock(cur_snap.budget))
							)
						local line2 = string.format("  Platform: %s  |  ⏱ %s", cur_ps.spec.platform or "Judge", c_str)
						pcall(function()
							vim.bo[arena.popup.buf].modifiable = true
							vim.api.nvim_buf_set_lines(arena.popup.buf, 1, 2, false, { line2 })
							vim.bo[arena.popup.buf].modifiable = false
						end)
					end
				end

				require("competitive.arena.dashboard").refresh_if_open()
			end)
		)
	end
end

return M
