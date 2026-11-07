-- ~/.config/nvim/lua/competitive/init.lua
-- State manager and macro payload for the competitive programming environment.

local M = {}

-- Global state flag read by other competitive modules to prevent execution outside a session
M.is_active = false

-- Translates human-readable keystrings (e.g., <CR>, <Esc>) into Vim byte codes.
-- Essential for making macro registers maintainable.
local function t(str)
	return vim.api.nvim_replace_termcodes(str, true, false, true)
end

-- Pre-compiled macro payloads loaded into Vim registers during an active session
local registers = {
	-- Register 't': Appends a standard test case loop and leaves editor in Insert mode
	t = t("oint testcases;<CR>cin >> testcases;<CR><CR>while(testcases--) {"),
	-- Register 'm': Reads modular arithmetic template directly below line 18
	m = t(":18r ../../algorithms/modular_arithmetic.cpp<CR>"),
	-- Register 'd': Injects debug directives at line 2.
	-- Uses mark 'z' to anchor current position, executes injection, and jumps back to 'z'.
	d = t(
		'mz2GO#ifdef LOCAL<CR>#include "../../algorithms/debug.cpp"<CR>#else<CR>#define debug(...) ""<CR>#endif<Esc>`z'
	),
}
--
-- Initializes the session: sets working directory, loads macros, and triggers environment autocommands
function M.start_session()
	if M.is_active then
		vim.notify("Competitive session already in progress", vim.log.levels.WARN)
		return
	end

	M.is_active = true
	vim.cmd("cd ~/playground/contests/")

	for k, v in pairs(registers) do
		vim.fn.setreg(k, v)
	end
	require("competitive.scaffold").toggle_templates(true)
	require("competitive.layout").toggle_autosync(true)

	vim.notify("Competitive session activated", vim.log.levels.INFO)
end

-- Tears down the session: clears macros, disables environment autocommands, and collapses splits
function M.end_session()
	if not M.is_active then
		vim.notify("Not in competitive session, ignoring request", vim.log.levels.WARN)
		return
	end

	M.is_active = false

	for k, _ in pairs(registers) do
		vim.fn.setreg(k, "")
	end

	require("competitive.scaffold").toggle_templates(false)
	require("competitive.layout").toggle_autosync(false)

	vim.cmd("only")
	vim.notify("Competitive session ended", vim.log.levels.INFO)
end

return M
