-- ~/.config/nvim/lua/competitive/arena/config.lua
-- Centralized configuration and path discovery for the Competitive Programming Arena.
-- Completely independent of theme_ac. Targets Ubuntu WSL natively.

local M = {}

M.python_cmd = "python3"
M.practice_dir = vim.fn.expand("~/playground/contests/practice/")
M.pointer_file = vim.fn.expand("~/.pi-arena-root")

-- Collision-free prefix (<leader>e is NvimTree, <leader>c is Competitive/LSP, <leader>a is Theme-AC).
M.keymap_prefix = "<leader>m"

-- True-judge compilation flags (no -D LOCAL) so <leader>mt evaluates pure stdin/stdout
-- without #ifdef LOCAL debug prints or execution-time footers.
M.compiler = "g++"
M.compile_flags = "-std=c++17 -Wshadow -Wall -O2 -Wno-unused-result -Winvalid-pch"

-- Maximum number of rated records plotted on the CF Rating Trajectory graph.
M.graph_history_limit = 100

-- Resolve the .pi/arena directory written by .pi/extensions/arena.ts
function M.resolve_arena_dir()
	if vim.env.PI_ARENA_DIR and vim.env.PI_ARENA_DIR ~= "" then
		return vim.fn.expand(vim.env.PI_ARENA_DIR)
	end

	if vim.fn.filereadable(M.pointer_file) == 1 then
		local lines = vim.fn.readfile(M.pointer_file)
		if lines and #lines > 0 then
			local dir = vim.trim(lines[1])
			if dir ~= "" and vim.fn.isdirectory(dir) == 1 then
				return dir
			end
		end
	end

	-- Fallback: walk up from current working directory
	local cur = vim.fn.getcwd()
	while cur and cur ~= "/" and cur ~= "" do
		local candidate = cur .. "/.pi/arena"
		if vim.fn.isdirectory(candidate) == 1 then
			return candidate
		end
		local parent = vim.fn.fnamemodify(cur, ":h")
		if parent == cur then
			break
		end
		cur = parent
	end

	return nil
end

function M.paths()
	local arena_dir = M.resolve_arena_dir()
	if not arena_dir then
		return nil
	end
	local active_dir = arena_dir .. "/active"
	return {
		arena_dir = arena_dir,
		script_path = arena_dir .. "/arena.py",
		rating_file = arena_dir .. "/rating.json",
		history_file = arena_dir .. "/history.json",
		active_dir = active_dir,
		manifest_file = active_dir .. "/manifest.json",
		events_file = active_dir .. "/events.jsonl",
		result_file = active_dir .. "/result.json",
		scratch_dir = active_dir .. "/scratch",
	}
end

-- WSL-aware browser opener chain (checks vim.fn.executable before jobstart
-- so missing xdg-open/wslview never throws E475, falling back to Windows
-- interop cmd.exe/powershell.exe and finally clipboard).
function M.open_in_browser(url)
	if not url or url == "" then
		vim.notify("[Arena] No URL available for this problem.", vim.log.levels.WARN)
		return
	end

	local candidates = {
		{ "wslview", url },
		{ "xdg-open", url },
		{ "cmd.exe", "/c", "start", "", url },
		{ "powershell.exe", "-NoProfile", "-Command", "Start-Process", url },
	}

	for _, cmd in ipairs(candidates) do
		if vim.fn.executable(cmd[1]) == 1 then
			vim.fn.jobstart(cmd, { detach = true })
			vim.notify("[Arena] Opening " .. url, vim.log.levels.INFO)
			return
		end
	end

	vim.fn.setreg("+", url)
	vim.notify("[Arena] No browser opener found — URL copied to clipboard: " .. url, vim.log.levels.WARN)
end

function M.setup_highlights()
	local links = {
		ArenaHeader = "Title",
		ArenaSubheader = "Function",
		ArenaTabActive = "Function",
		ArenaTabInactive = "Comment",
		ArenaTimerOk = "Number",
		ArenaTimerWarn = "WarningMsg",
		ArenaOvertime = "ErrorMsg",
		ArenaVerdictAC = "String",
		ArenaVerdictWA = "ErrorMsg",
		ArenaVerdictSubmit = "Special",
		ArenaBlind = "Special",
		ArenaHint = "String",
		ArenaMuted = "NonText",
		ArenaGraphLine = "Special",
	}
	for name, link in pairs(links) do
		vim.api.nvim_set_hl(0, name, { link = link, default = true })
	end
end

return M
