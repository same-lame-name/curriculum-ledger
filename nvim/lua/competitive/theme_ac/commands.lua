-- ~/.config/nvim/lua/competitive/theme_ac/commands.lua
-- User commands and which-key registration for Theme-AC (Epic 6). Thin
-- wiring layer only - every command delegates to functions already
-- implemented and manually verified in MVP 1-3 (theme_ac/init.lua,
-- theme_ac/dashboard.lua). Nothing here contains new business logic.

local M = {}

-- Best-effort dashboard refresh: safe to call even if the dashboard has
local function refresh_dashboard_if_open()
	require("competitive.theme_ac.dashboard").refresh_if_open()
end

-- Formats a duration in seconds as "Nm SSs" (or just "SSs" under a minute).
-- Returns "n/a" for nil/missing values (e.g. no AC logged yet).
local function format_duration(seconds)
	if not seconds or seconds == vim.NIL then
		return "n/a"
	end
	local m = math.floor(seconds / 60)
	local s = seconds % 60
	if m == 0 then
		return string.format("%ds", s)
	end
	return string.format("%dm %02ds", m, s)
end

-- MVP 5: a genuinely useful stats breakdown, not just the raw rating.json
-- fields - verdict counts, solve rate, upsolve/experimental attempt counts,
-- and AC-duration extremes, all computed server-side (theme_ac.py's
-- compute_detailed_stats) directly from the history.json ledger.
local function show_stats()
	local ac = require("competitive.theme_ac")
	ac.run_python({ "stats" }, function(result, err)
		if err then
			vim.notify("Theme-AC: " .. err, vim.log.levels.ERROR)
			return
		end

		local vb = result.verdict_breakdown or {}
		local solve_rate_pct = result.solve_rate and string.format("%.0f%%", result.solve_rate * 100) or "n/a"
		local delta = result.rating_delta or 0
		local sign = delta >= 0 and "+" or ""

		local lines = {
			string.format("Theme-AC Stats \u{2014} Rating: %d (%s%d since start)", result.current_rating, sign, delta),
			string.format(
				"  Solved: %d / Attempted: %d  (%s solve rate)",
				result.total_solved,
				result.total_attempted,
				solve_rate_pct
			),
			string.format(
				"  Verdicts:  AC:%d  Hints:%d  WA:%d  TLE:%d  MLE:%d  Abandon:%d  DNF:%d",
				vb.AC or 0,
				vb.AC_HINTS or 0,
				vb.WA or 0,
				vb.TLE or 0,
				vb.MLE or 0,
				vb.ABANDON or 0,
				vb.DNF or 0
			),
			string.format(
				"  Upsolve attempts: %d   Experimental attempts: %d",
				result.upsolve_attempts or 0,
				result.experimental_attempts or 0
			),
			string.format("  Avg AC time: %s", format_duration(result.avg_ac_duration_seconds)),
		}

		if result.fastest_ac then
			table.insert(
				lines,
				string.format(
					"  Fastest AC: %s (%s)",
					result.fastest_ac.problem_id,
					format_duration(result.fastest_ac.duration_seconds)
				)
			)
		end
		if result.slowest_ac then
			table.insert(
				lines,
				string.format(
					"  Slowest AC: %s (%s)",
					result.slowest_ac.problem_id,
					format_duration(result.slowest_ac.duration_seconds)
				)
			)
		end

		vim.notify(table.concat(lines, "\n"), vim.log.levels.INFO)
	end)
end

local function force_sync()
	local ac = require("competitive.theme_ac")
	vim.notify("Theme-AC: forcing cache sync (this may take a few seconds)...", vim.log.levels.INFO)
	ac.run_python({ "sync", "--force" }, function(result, err)
		if err then
			vim.notify("Theme-AC: " .. err, vim.log.levels.ERROR)
			return
		end
		vim.notify(
			string.format("Theme-AC: sync complete (%d usable problems).", result.usable_problems),
			vim.log.levels.INFO
		)
	end)
end

local function verdict_and_refresh()
	require("competitive.theme_ac").verdict_prompt(refresh_dashboard_if_open)
end

function M.setup()
	local dashboard = require("competitive.theme_ac.dashboard")
	local ac = require("competitive.theme_ac")

	vim.api.nvim_create_user_command("ThemeAC", dashboard.toggle, {
		desc = "Toggle the Theme-AC dashboard",
	})

	vim.api.nvim_create_user_command("ThemeACVerdict", verdict_and_refresh, {
		desc = "Log a Theme-AC verdict for an in-progress problem",
	})

	vim.api.nvim_create_user_command("ThemeACClose", function()
		ac.close_session(dashboard.close)
	end, {
		desc = "Close the Theme-AC session (prompts to abandon unresolved problems)",
	})

	vim.api.nvim_create_user_command("ThemeACSync", force_sync, {
		desc = "Force re-download of the Theme-AC problem/difficulty cache",
	})

	vim.api.nvim_create_user_command("ThemeACStats", show_stats, {
		desc = "Show current Theme-AC rating and statistics",
	})

	vim.api.nvim_create_user_command("ThemeACGraph", dashboard.show_graph, {
		desc = "Show the Theme-AC rating history graph",
	})

	-- which-key registration, matching the plan's <leader>a namespace -
	-- orthogonal to the existing <leader>c (competitive) and <leader>t
	-- (terminal) namespaces, zero collision risk.
	local ok, wk = pcall(require, "which-key")
	if not ok then
		return
	end

	wk.add({
		{ "<leader>a", group = "AtCoder (Theme-AC)" },
		{ "<leader>aa", dashboard.toggle, desc = "Theme-AC Dashboard" },
		{ "<leader>av", verdict_and_refresh, desc = "Log Verdict" },
		{ "<leader>as", show_stats, desc = "Rating & Stats" },
		{ "<leader>ag", dashboard.show_graph, desc = "Rating Graph" },
		{
			"<leader>ax",
			function()
				ac.close_session(dashboard.close)
			end,
			desc = "Close Theme-AC Session",
		},
	})
end

return M

