-- ~/.config/nvim/lua/competitive/arena/commands.lua
-- User commands (:Arena*) and <leader>m which-key bindings for the Competitive Programming Arena.
-- Orthogonal to <leader>c (Competitive layout/runner), <leader>a (Theme-AC), and <leader>e (NvimTree).

local M = {}

function M.setup()
	local arena = require("competitive.arena")
	local config = require("competitive.arena.config")
	local pfx = config.keymap_prefix or "<leader>m"

	vim.api.nvim_create_user_command("Arena", function()
		arena.open_or_toggle()
	end, {
		desc = "Open or toggle the Competitive Programming Arena dashboard",
	})

	vim.api.nvim_create_user_command("ArenaCard", function()
		arena.show_problem_card()
	end, {
		desc = "Show current Arena problem statement, constraints, samples, and unlocked hints",
	})

	vim.api.nvim_create_user_command("ArenaTest", function()
		arena.test_samples()
	end, {
		desc = "Compile current Arena problem (true judge, no -D LOCAL) and test all manifest samples",
	})

	vim.api.nvim_create_user_command("ArenaHint", function()
		arena.request_hint()
	end, {
		desc = "Reveal the next progressive Socratic hint for the current Arena problem",
	})

	vim.api.nvim_create_user_command("ArenaOpen", function()
		arena.open_url()
	end, {
		desc = "Open current Arena problem URL in browser",
	})

	vim.api.nvim_create_user_command("ArenaVerdict", function()
		arena.verdict_prompt()
	end, {
		desc = "Record Online Judge verdict or hand code to the Teacher",
	})

	vim.api.nvim_create_user_command("ArenaClose", function()
		arena.close_session()
	end, {
		desc = "End the Arena session early and return results to the Teacher in pi",
	})

	local ok, wk = pcall(require, "which-key")
	if not ok then
		return
	end

	wk.add({
		{ pfx, group = "Mentor / Arena" },
		{ pfx .. "a", arena.open_or_toggle, desc = "Arena Dashboard (Queue & Standing)" },
		{ pfx .. "c", arena.show_problem_card, desc = "Problem Card & Samples" },
		{ pfx .. "t", arena.test_samples, desc = "Test Manifest Samples (Judge)" },
		{ pfx .. "h", arena.request_hint, desc = "Request Socratic Hint" },
		{ pfx .. "o", arena.open_url, desc = "Open Problem URL in Browser" },
		{ pfx .. "v", arena.verdict_prompt, desc = "Record Verdict / Submit" },
		{ pfx .. "x", arena.close_session, desc = "End Session Early" },
	})
end

return M
